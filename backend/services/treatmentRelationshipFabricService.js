import { getContract } from "./fabricService.js";
import { generateID } from "./idService.js";
import { notify, NotificationEvents } from "./notificationService.js";
import { PatientAuth, Doctor } from "./db.js";

/**
 * Treatment Relationship Service
 *
 * A treatment relationship proves a doctor has a legitimate
 * clinical reason to access a patient's records.
 *
 * Relationship types:
 * - RECENT_APPOINTMENT
 * - FOLLOW_UP_CHECKUP
 * - ONGOING_TREATMENT
 * - REFERRED_BY_DOCTOR
 * - ASSIGNED_EMERGENCY_PHYSICIAN
 *
 * Status:
 * - ACTIVE   — doctor has access to normal records
 * - DORMANT  — no activity for 30 days, access suspended
 * - DISCHARGED — doctor explicitly discharged patient, access revoked
 */

export const TreatmentRelationshipTypes = [
    "RECENT_APPOINTMENT",
    "FOLLOW_UP_CHECKUP",
    "ONGOING_TREATMENT",
    "REFERRED_BY_DOCTOR",
    "ASSIGNED_EMERGENCY_PHYSICIAN",
];

const EMERGENCY_RELATIONSHIP_TYPE = "ASSIGNED_EMERGENCY_PHYSICIAN";
const EMERGENCY_ONLY_MESSAGE =
    "Emergency relationships can only be ended by closing the emergency access.";

/**
 * Create a treatment relationship between a doctor and patient.
 *
 * By default (requirePatientApproval = true, which is what the doctor-facing
 * route uses) the relationship is created PENDING and grants nothing until
 * the patient approves it via approveTreatmentRelationship(). The doctor
 * cannot attest to their own clinical relationship.
 *
 * emergencyFabricService.js is the only caller that passes
 * { requirePatientApproval: false }: an emergency episode is ACTIVE
 * immediately (the patient may be unconscious) and is notified + time-boxed
 * there. ASSIGNED_EMERGENCY_PHYSICIAN can be created no other way.
 */
export async function createTreatmentRelationship(data, { requirePatientApproval = true } = {}) {
    let gateway, client;
    try {
        if (!TreatmentRelationshipTypes.includes(data.relationshipType)) {
            return {
                status: "FAILED",
                message: `Invalid relationshipType. Must be one of: ${TreatmentRelationshipTypes.join(", ")}`,
            };
        }

        if (requirePatientApproval) {
            if (data.relationshipType === "ASSIGNED_EMERGENCY_PHYSICIAN") {
                return {
                    status: "ACCESS_DENIED",
                    message: "ASSIGNED_EMERGENCY_PHYSICIAN relationships can only be created through emergency access.",
                };
            }
            const patientExists = await PatientAuth.findOne({ patientID: data.patientID });
            if (!patientExists) {
                return { status: "FAILED", message: "Patient not found." };
            }
        }
        const initialStatus = requirePatientApproval ? "PENDING" : "ACTIVE";

        const relationshipID = generateID("treatmentRelationship");
        const now            = new Date();

        // Dormant threshold: defaults to 30 days, but callers (e.g. emergency
        // access) can pass a shorter window via data.dormantAfterHours.
        const dormantHours = data.dormantAfterHours ?? 30 * 24;
        const dormantAfter = new Date(now.getTime() + dormantHours * 60 * 60 * 1000).toISOString();
        const timestamp    = now.toISOString();

        const result = await getContract("hospital");
        gateway = result.gateway;
        client  = result.client;
        const { contract } = result;

        await contract.submitTransaction(
            "CreateTreatmentRelationship",
            relationshipID,
            data.patientID,
            data.doctorID,
            data.relationshipType,
            data.notes ?? "",
            initialStatus,
            dormantAfter,
            timestamp,
            timestamp
        );

        if (requirePatientApproval) {
            const patient = await PatientAuth.findOne({ patientID: data.patientID });
            const doctor  = await Doctor.findOne({ doctorID: data.doctorID });
            if (patient && doctor) {
                await notify({
                    recipientID:   data.patientID,
                    recipientRole: "patient",
                    phone:         patient.phone,
                    event:         "TREATMENT_RELATIONSHIP_REQUEST",
                    message:       NotificationEvents.TREATMENT_RELATIONSHIP_REQUEST(doctor.fullName, data.relationshipType),
                    channel:       "sms",
                });
            }
        }

        return {
            status: "SUCCESS",
            relationshipID,
            dormantAfter,
            relationshipStatus: initialStatus,
            requiresPatientApproval: requirePatientApproval,
        };
    } catch (err) {
        console.error("[TreatmentRelationship] create failed:", err);
        return { status: "FAILED", message: err.message };
    } finally {
        if (gateway) await gateway.close();
        if (client)  client.close();
    }
}

/**
 * Get a treatment relationship record.
 */
export async function getTreatmentRelationship(relationshipID, actorID, actorRole) {
    let gateway, client;
    try {
        const result = await getContract("hospital");
        gateway = result.gateway;
        client  = result.client;
        const { contract } = result;

        const raw  = await contract.evaluateTransaction("GetTreatmentRelationship", relationshipID);
        const data = JSON.parse(Buffer.from(raw).toString("utf8"));

        // Only the patient the relationship is about, or the doctor on it,
        // may view it.
        const isOwner =
            (actorRole === "patient" && actorID === data.patientID) ||
            (actorRole === "doctor"  && actorID === data.doctorID);
        if (!isOwner) {
            return { status: "ACCESS_DENIED", message: "You do not have permission to view this treatment relationship." };
        }

        return { status: "SUCCESS", data };
    } catch (err) {
        return { status: "FAILED", message: err.message };
    } finally {
        if (gateway) await gateway.close();
        if (client)  client.close();
    }
}
export async function getTreatmentRelationshipsByDoctor(doctorID) {
    let gateway, client;
    try {
        const result = await getContract("hospital");
        gateway = result.gateway;
        client  = result.client;
        const { contract } = result;
        const raw = await contract.evaluateTransaction("GetTreatmentRelationshipsByDoctor", doctorID);
        const text = Buffer.from(raw).toString("utf8");
        return { status: "SUCCESS", data: text ? JSON.parse(text) : [] };
    } catch (err) {
        return { status: "FAILED", message: err.message };
    } finally {
        if (gateway) await gateway.close();
        if (client)  client.close();
    }
}

export async function getTreatmentRelationshipsByPatient(patientID) {
    let gateway, client;
    try {
        const result = await getContract("hospital");
        gateway = result.gateway;
        client  = result.client;
        const { contract } = result;
        const raw = await contract.evaluateTransaction("GetTreatmentRelationshipsByPatient", patientID);
        const text = Buffer.from(raw).toString("utf8");
        return { status: "SUCCESS", data: text ? JSON.parse(text) : [] };
    } catch (err) {
        return { status: "FAILED", message: err.message };
    } finally {
        if (gateway) await gateway.close();
        if (client)  client.close();
    }
}
/**
 * Check if an ACTIVE treatment relationship exists between
 * a doctor and patient. Used as access gate for normal records.
 *
 * @returns {boolean}
 */
export async function hasActiveTreatmentRelationship(doctorID, patientID) {
    let gateway, client;
    try {
        const result = await getContract("hospital");
        gateway = result.gateway;
        client  = result.client;
        const { contract } = result;

        const raw = await contract.evaluateTransaction(
            "CheckActiveTreatmentRelationship",
            doctorID,
            patientID
        );

        return Buffer.from(raw).toString("utf8") === "true";
    } catch (err) {
        console.error("[TreatmentRelationship] check failed:", err);
        return false;
    } finally {
        if (gateway) await gateway.close();
        if (client)  client.close();
    }
}

/**
 * Discharge a patient — sets relationship to DISCHARGED and revokes access.
 *
 * options.notifyPatient (default true): send the "relationship ended" SMS.
 * A caller that sends its own message, or that may call this repeatedly for the
 * same relationship (the emergency expiry sweeper retries), passes false.
 */
export async function dischargePatient(relationshipID, doctorID, skipOwnershipCheck = false, { notifyPatient = true } = {}) {
    let gateway, client;
    try {
        const result = await getContract("hospital");
        gateway = result.gateway;
        client  = result.client;
        const { contract } = result;

        // Fetch and verify ownership BEFORE mutating — only the doctor on
        // the relationship may discharge it. emergencyFabricService.js
        // already verifies ownership itself before calling this to close an
        // emergency episode, so it passes skipOwnershipCheck to avoid a
        // redundant lookup — every other caller goes through the check.
        const preRaw  = await contract.evaluateTransaction("GetTreatmentRelationship", relationshipID);
        const preData = JSON.parse(Buffer.from(preRaw).toString("utf8"));
        if (!skipOwnershipCheck && preData.doctorID !== doctorID) {
            return { status: "ACCESS_DENIED", message: "You do not have permission to discharge this relationship." };
        }
        if (!skipOwnershipCheck && preData.relationshipType === EMERGENCY_RELATIONSHIP_TYPE) {
            return { status: "ACCESS_DENIED", message: EMERGENCY_ONLY_MESSAGE };
        }

        const updatedAt = new Date().toISOString();

        await contract.submitTransaction(
            "UpdateTreatmentRelationshipStatus",
            relationshipID,
            "DISCHARGED",
            updatedAt
        );

        if (notifyPatient) {
            const raw     = await contract.evaluateTransaction("GetTreatmentRelationship", relationshipID);
            const relData = JSON.parse(Buffer.from(raw).toString("utf8"));
            const patient = await PatientAuth.findOne({ patientID: relData.patientID });
            const doctor  = await Doctor.findOne({ doctorID });

            if (patient && doctor) {
                await notify({
                    recipientID:   relData.patientID,
                    recipientRole: "patient",
                    phone:         patient.phone,
                    event:         "TREATMENT_RELATIONSHIP_ENDED",
                    message:       NotificationEvents.TREATMENT_RELATIONSHIP_ENDED(doctor.fullName),
                    channel:       "sms",
                });
            }
        }

        return { status: "SUCCESS", relationshipID };
    } catch (err) {
        return { status: "FAILED", message: err.message };
    } finally {
        if (gateway) await gateway.close();
        if (client)  client.close();
    }
}

/**
 * Mark a treatment relationship as DORMANT.
 * Called automatically when no activity for 30 days.
 * Can also be called manually by admin.
 */
export async function markDormant(relationshipID, doctorID) {
    let gateway, client;
    try {
        const result = await getContract("hospital");
        gateway = result.gateway;
        client  = result.client;
        const { contract } = result;

        // No admin role exists yet (see module docstring), so for now this
        // is restricted to the doctor on the relationship, same as discharge.
        const preRaw  = await contract.evaluateTransaction("GetTreatmentRelationship", relationshipID);
        const preData = JSON.parse(Buffer.from(preRaw).toString("utf8"));
        if (preData.doctorID !== doctorID) {
            return { status: "ACCESS_DENIED", message: "You do not have permission to modify this relationship." };
        }
        if (preData.relationshipType === EMERGENCY_RELATIONSHIP_TYPE) {
            return { status: "ACCESS_DENIED", message: EMERGENCY_ONLY_MESSAGE };
        }

        const updatedAt = new Date().toISOString();

        await contract.submitTransaction(
            "UpdateTreatmentRelationshipStatus",
            relationshipID,
            "DORMANT",
            updatedAt
        );

        return { status: "SUCCESS", relationshipID };
    } catch (err) {
        return { status: "FAILED", message: err.message };
    } finally {
        if (gateway) await gateway.close();
        if (client)  client.close();
    }
}

/**
 * Ask to resume a dormant (or expired) relationship, e.g. new appointment.
 * Puts it back to PENDING; access only resumes when the patient approves via
 * approveTreatmentRelationship(), which also resets the 30-day timer. Doctors
 * can no longer renew their own access unilaterally.
 */
export async function reactivateTreatmentRelationship(relationshipID, doctorID) {
    let gateway, client;
    try {
        const result = await getContract("hospital");
        gateway = result.gateway;
        client  = result.client;
        const { contract } = result;

        const preRaw  = await contract.evaluateTransaction("GetTreatmentRelationship", relationshipID);
        const preData = JSON.parse(Buffer.from(preRaw).toString("utf8"));
        if (preData.doctorID !== doctorID) {
            return { status: "ACCESS_DENIED", message: "You do not have permission to modify this relationship." };
        }
        if (preData.relationshipType === EMERGENCY_RELATIONSHIP_TYPE) {
            return { status: "ACCESS_DENIED", message: EMERGENCY_ONLY_MESSAGE };
        }

        // Only a lapsed relationship can be re-requested: DORMANT, or stored
        // ACTIVE but past DormantAfter (dormancy is evaluated on read, not
        // persisted). PENDING / DISCHARGED / still-active ones cannot.
        const lapsed =
            preData.status === "DORMANT" ||
            (preData.status === "ACTIVE" && new Date(preData.dormantAfter) <= new Date());
        if (!lapsed) {
            return {
                status:  "FAILED",
                message: `Only a DORMANT or expired relationship can be reactivated (current status: ${preData.status}).`,
            };
        }

        await contract.submitTransaction(
            "UpdateTreatmentRelationshipStatus",
            relationshipID,
            "PENDING",
            new Date().toISOString()
        );

        const patient = await PatientAuth.findOne({ patientID: preData.patientID });
        const doctor  = await Doctor.findOne({ doctorID });
        if (patient && doctor) {
            await notify({
                recipientID:   preData.patientID,
                recipientRole: "patient",
                phone:         patient.phone,
                event:         "TREATMENT_RELATIONSHIP_RENEWAL_REQUEST",
                message:       NotificationEvents.TREATMENT_RELATIONSHIP_RENEWAL_REQUEST(doctor.fullName),
                channel:       "sms",
            });
        }

        return {
            status: "SUCCESS",
            relationshipID,
            relationshipStatus: "PENDING",
            requiresPatientApproval: true,
        };
    } catch (err) {
        return { status: "FAILED", message: err.message };
    } finally {
        if (gateway) await gateway.close();
        if (client)  client.close();
    }
}

/**
 * Patient approves a PENDING treatment relationship (new, or a renewal
 * request after dormancy). Only the patient the relationship is about may
 * approve. Activation goes through the existing chaincode
 * ReactivateTreatmentRelationship, which also starts a fresh 30-day window.
 */
export async function approveTreatmentRelationship(relationshipID, patientID) {
    let gateway, client;
    try {
        const result = await getContract("hospital");
        gateway = result.gateway;
        client  = result.client;
        const { contract } = result;

        const preRaw  = await contract.evaluateTransaction("GetTreatmentRelationship", relationshipID);
        const preData = JSON.parse(Buffer.from(preRaw).toString("utf8"));
        if (preData.patientID !== patientID) {
            return { status: "ACCESS_DENIED", message: "You do not have permission to approve this relationship." };
        }
        if (preData.status !== "PENDING") {
            return { status: "FAILED", message: `Only a PENDING relationship can be approved (current status: ${preData.status}).` };
        }

        const now          = new Date();
        const dormantAfter = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();

        await contract.submitTransaction(
            "ReactivateTreatmentRelationship",
            relationshipID,
            dormantAfter,
            now.toISOString()
        );

        return { status: "SUCCESS", relationshipID, relationshipStatus: "ACTIVE", dormantAfter };
    } catch (err) {
        return { status: "FAILED", message: err.message };
    } finally {
        if (gateway) await gateway.close();
        if (client)  client.close();
    }
}

/**
 * Patient rejects a PENDING treatment relationship. The relationship is
 * DISCHARGED (terminal), so it can never be reactivated.
 */
export async function rejectTreatmentRelationship(relationshipID, patientID) {
    let gateway, client;
    try {
        const result = await getContract("hospital");
        gateway = result.gateway;
        client  = result.client;
        const { contract } = result;

        const preRaw  = await contract.evaluateTransaction("GetTreatmentRelationship", relationshipID);
        const preData = JSON.parse(Buffer.from(preRaw).toString("utf8"));
        if (preData.patientID !== patientID) {
            return { status: "ACCESS_DENIED", message: "You do not have permission to reject this relationship." };
        }
        if (preData.status !== "PENDING") {
            return { status: "FAILED", message: `Only a PENDING relationship can be rejected (current status: ${preData.status}).` };
        }

        await contract.submitTransaction(
            "UpdateTreatmentRelationshipStatus",
            relationshipID,
            "DISCHARGED",
            new Date().toISOString()
        );

        return { status: "SUCCESS", relationshipID, relationshipStatus: "DISCHARGED" };
    } catch (err) {
        return { status: "FAILED", message: err.message };
    } finally {
        if (gateway) await gateway.close();
        if (client)  client.close();
    }
}
