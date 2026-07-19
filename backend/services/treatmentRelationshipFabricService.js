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

/**
 * Create a treatment relationship between a doctor and patient.
 */
export async function createTreatmentRelationship(data) {
    let gateway, client;
    try {
        if (!TreatmentRelationshipTypes.includes(data.relationshipType)) {
            return {
                status: "FAILED",
                message: `Invalid relationshipType. Must be one of: ${TreatmentRelationshipTypes.join(", ")}`,
            };
        }

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
            "ACTIVE",
            dormantAfter,
            timestamp,
            timestamp
        );

        return { status: "SUCCESS", relationshipID, dormantAfter };
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
 */
export async function dischargePatient(relationshipID, doctorID, skipOwnershipCheck = false) {
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

        const updatedAt = new Date().toISOString();

        await contract.submitTransaction(
            "UpdateTreatmentRelationshipStatus",
            relationshipID,
            "DISCHARGED",
            updatedAt
        );

        // Notify patient
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
 * Reactivate a dormant relationship (e.g. new appointment scheduled).
 * Resets the dormant timer for another 30 days.
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

        const now          = new Date();
        const dormantAfter = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();
        const updatedAt    = now.toISOString();

        await contract.submitTransaction(
            "ReactivateTreatmentRelationship",
            relationshipID,
            dormantAfter,
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
