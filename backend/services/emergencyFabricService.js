import { getContract } from "./fabricService.js";
import { logAudit } from "./auditMiddleware.js";
import { notify, NotificationEvents } from "./notificationService.js";
import { PatientAuth, Doctor, EmergencyAccessLog } from "./db.js";
import { generateID } from "./idService.js";
import { createTreatmentRelationship, dischargePatient } from "./treatmentRelationshipFabricService.js";

// Safety-net ceiling: an emergency relationship auto-expires after this many
// hours even if nobody explicitly closes it. Chosen as a fixed value here
// because there's no per-hospital config yet — see the module docstring in
// closeEmergencyAccess() for the explicit-close path, which is the one that
// should normally end an emergency episode well before this fires.
const EMERGENCY_ACCESS_SAFETY_NET_HOURS = 24;

// Moves the on-chain EmergencyAccess record out of ACTIVE (CLOSED or ABORTED).
// Best-effort: callers have already dealt with the actual access, so a ledger
// hiccup here is logged and never turns a revoked access back into an error.
// Pass an open contract to reuse its connection, otherwise one is opened.
async function markLedgerEmergencyStatus(emergencyAccessID, status, existingContract) {
    let gateway, client;
    try {
        let contract = existingContract;
        if (!contract) {
            const result = await getContract("hospital");
            gateway  = result.gateway;
            client   = result.client;
            contract = result.contract;
        }
        await contract.submitTransaction(
            "UpdateEmergencyAccessStatus",
            emergencyAccessID,
            status,
            new Date().toISOString()
        );
        return true;
    } catch (err) {
        console.error(`[EmergencyAccess] Failed to mark ledger record ${emergencyAccessID} ${status}:`, err.message);
        return false;
    } finally {
        if (gateway) await gateway.close();
        if (client)  client.close();
    }
}

export async function createEmergencyAccess(data, actorID) {
    let gateway, client;
    try {
        const patientRecord = await PatientAuth.findOne({ patientID: data.patientID });
        if (!patientRecord) {
            return { status: "NOT_FOUND", message: `Patient ${data.patientID} not found.` };
        }

        // Prevent redundant emergency-access episodes: if this doctor already
        // has an active, unexpired ASSIGNED_EMERGENCY_PHYSICIAN relationship
        // for this patient, don't create a duplicate ledger entry + relationship.
        const existing = await EmergencyAccessLog.findOne({
            doctorID:  data.doctorID,
            patientID: data.patientID,
            status:    "ACTIVE",
            expiresAt: { $gt: new Date().toISOString() },
        });
        if (existing) {
            return {
                status: "FAILED",
                message: `You already have active emergency access to this patient (opened ${existing.createdAt}, expires ${existing.expiresAt}). Close it before opening a new one, or continue using the existing access.`,
            };
        }

        const emergencyAccessID = generateID("emergency");

        const result = await getContract("hospital");
        gateway = result.gateway;
        client  = result.client;
        const { contract } = result;

        const timestamp = new Date().toISOString();

        await contract.submitTransaction(
            "CreateEmergencyAccess",
            emergencyAccessID,
            data.patientID,
            data.doctorID,
            data.reason,
            "ACTIVE",
            timestamp
        );

        await logAudit({
            actorID:      actorID ?? data.doctorID,
            actorRole:    "doctor",
            action:       "CREATE",
            resourceType: "EMERGENCY_ACCESS",
            resourceID:   data.patientID,
        });

        // Grant the doctor an ASSIGNED_EMERGENCY_PHYSICIAN treatment relationship
        // so this emergency access actually satisfies the normal
        // hasActiveTreatmentRelationship() gate used by consultation/prescription/
        // labreport/patient reads. Without this, emergency access is inert.
        //
        // dormantAfterHours caps this relationship at 24 hours instead of the
        // default 30 days — CheckActiveTreatmentRelationship in chaincode
        // already auto-expires relationships past their DormantAfter timestamp,
        // so this alone is enough for the "forgotten emergency session" safety
        // net, with no chaincode change required. Explicit closure (see
        // closeEmergencyAccess below) is still the expected normal path and
        // should usually happen well before this ceiling.
        const relationshipResult = await createTreatmentRelationship({
            patientID: data.patientID,
            doctorID:  data.doctorID,
            relationshipType: "ASSIGNED_EMERGENCY_PHYSICIAN",
            notes: `Emergency access ${emergencyAccessID}: ${data.reason}`,
            dormantAfterHours: EMERGENCY_ACCESS_SAFETY_NET_HOURS,
        }, { requirePatientApproval: false });

        if (relationshipResult.status !== "SUCCESS") {
            console.error(
                "[EmergencyAccess] Failed to create backing treatment relationship:",
                relationshipResult.message
            );
            await markLedgerEmergencyStatus(emergencyAccessID, "ABORTED", contract);
            return { status: "FAILED", message: "Failed to grant emergency access relationship." };
        }

        // Track the emergencyAccessID <-> relationshipID link and expiry so
        // closeEmergencyAccess() knows what to revoke. The ledger record's
        // status mirrors this (ACTIVE -> CLOSED/ABORTED), but this Mongo log
        // is what the close flow and the duplicate check read.
        try {
            await EmergencyAccessLog.create({
                emergencyAccessID,
                relationshipID: relationshipResult.relationshipID,
                doctorID:       data.doctorID,
                patientID:      data.patientID,
                reason:         data.reason,
                status:         "ACTIVE",
                expiresAt:      relationshipResult.dormantAfter,
                createdAt:      timestamp,
            });
        } catch (logErr) {
            // Without a log, closeEmergencyAccess() could never find this
            // relationship, so revoke it now rather than leave it open.
            console.error("[EmergencyAccess] Failed to write EmergencyAccessLog, revoking relationship:", logErr.message);
            await dischargePatient(relationshipResult.relationshipID, data.doctorID, true);
            await markLedgerEmergencyStatus(emergencyAccessID, "ABORTED", contract);
            return { status: "FAILED", message: "Failed to record emergency access." };
        }

        // Notify patient of emergency access
        const patient = patientRecord;
        const doctor  = await Doctor.findOne({ doctorID: data.doctorID });
        if (patient && doctor) {
            await notify({
                recipientID:   data.patientID,
                recipientRole: "patient",
                phone:         patient.phone,
                event:         "EMERGENCY_ACCESS",
                message:       NotificationEvents.EMERGENCY_ACCESS(doctor.fullName, data.reason),
                channel:       "sms",
            });
        }

        return { status: "SUCCESS", emergencyAccessID };
    } catch (err) {
        return { status: "FAILED", message: err.message };
    } finally {
        if (gateway) await gateway.close();
        if (client)  client.close();
    }
}

export async function getEmergencyAccess(emergencyAccessID, actorID, actorRole) {
    let gateway, client;
    try {
        // Same ownership rule as closeEmergencyAccess: only the patient the
        // episode belongs to, or the doctor who opened it, may read it.
        // Fails closed: every episode has a Mongo log (createEmergencyAccess
        // aborts otherwise), so no log means nobody can be verified as owner.
        const log = await EmergencyAccessLog.findOne({ emergencyAccessID });
        if (!log) {
            return { status: "NOT_FOUND", message: `Emergency access ${emergencyAccessID} not found.` };
        }
        const isOwner =
            (actorRole === "patient" && actorID === log.patientID) ||
            (actorRole === "doctor"  && actorID === log.doctorID);
        if (!isOwner) {
            await logAudit({ actorID, actorRole, action: "ACCESS_DENIED", resourceType: "EMERGENCY_ACCESS", resourceID: emergencyAccessID });
            return { status: "ACCESS_DENIED", message: "You do not have permission to view this emergency access record." };
        }

        const result = await getContract("hospital");
        gateway = result.gateway;
        client  = result.client;
        const { contract } = result;

        const raw  = await contract.evaluateTransaction("GetEmergencyAccess", emergencyAccessID);
        const data = JSON.parse(Buffer.from(raw).toString("utf8"));

        await logAudit({ actorID, actorRole, action: "READ", resourceType: "EMERGENCY_ACCESS", resourceID: emergencyAccessID });

        return { status: "SUCCESS", data };
    } catch (err) {
        console.error("[EmergencyAccess] getEmergencyAccess failed:", err);
        return { status: "FAILED", message: err.message };
    } finally {
        if (gateway) await gateway.close();
        if (client)  client.close();
    }
}

/**
 * Explicitly close an emergency access episode — the normal way an
 * emergency should end, well before the 24-hour safety net in
 * createEmergencyAccess() would otherwise expire it automatically.
 *
 * Revokes the doctor's actual access immediately by discharging the backing
 * ASSIGNED_EMERGENCY_PHYSICIAN treatment relationship (this is the part that
 * matters for security — CheckActiveTreatmentRelationship will return false
 * for it right away). It then marks the on-chain EmergencyAccess record
 * CLOSED (best-effort, via UpdateEmergencyAccessStatus) so the ledger no
 * longer shows the episode as ACTIVE.
 *
 * Only the doctor who opened the emergency access (or, in the future, some
 * hospital-admin role) should be able to close it — enforced by the caller
 * checking actorID against the stored doctorID before calling this.
 */
export async function closeEmergencyAccess(emergencyAccessID, actorID, actorRole) {
    try {
        const log = await EmergencyAccessLog.findOne({ emergencyAccessID });
        if (!log) {
            return { status: "NOT_FOUND", message: `No emergency access log found for ${emergencyAccessID}.` };
        }

        if (log.status === "CLOSED") {
            return { status: "FAILED", message: "This emergency access has already been closed." };
        }

        if (actorRole === "doctor" && actorID !== log.doctorID) {
            await logAudit({ actorID, actorRole, action: "ACCESS_DENIED", resourceType: "EMERGENCY_ACCESS", resourceID: emergencyAccessID });
            return { status: "ACCESS_DENIED", message: "Only the doctor who opened this emergency access can close it." };
        }

        // closeEmergencyAccess already verified actorID above, so skip the
        // redundant ownership re-check inside dischargePatient.
        const dischargeResult = await dischargePatient(log.relationshipID, log.doctorID, true);
        if (dischargeResult.status !== "SUCCESS") {
            console.error("[EmergencyAccess] Failed to discharge backing relationship on close:", dischargeResult.message);
            return { status: "FAILED", message: "Failed to revoke the underlying access relationship." };
        }

        await markLedgerEmergencyStatus(emergencyAccessID, "CLOSED");

        const closedAt = new Date().toISOString();
        log.status   = "CLOSED";
        log.closedAt = closedAt;
        log.closedBy = actorID;
        await log.save();

        await logAudit({ actorID, actorRole, action: "UPDATE", resourceType: "EMERGENCY_ACCESS", resourceID: emergencyAccessID });

        // Notify patient that emergency access has ended
        const patient = await PatientAuth.findOne({ patientID: log.patientID });
        const doctor  = await Doctor.findOne({ doctorID: log.doctorID });
        if (patient && doctor) {
            await notify({
                recipientID:   log.patientID,
                recipientRole: "patient",
                phone:         patient.phone,
                event:         "EMERGENCY_ACCESS_ENDED",
                message:       `Emergency access to your records by Dr. ${doctor.fullName} has ended.`,
                channel:       "sms",
            });
        }

        return { status: "SUCCESS", emergencyAccessID, closedAt };
    } catch (err) {
        console.error("[EmergencyAccess] closeEmergencyAccess failed:", err);
        return { status: "FAILED", message: err.message };
    }
}
