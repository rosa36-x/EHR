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

        // Dormant threshold: 30 days from now
        const dormantAfter = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();
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

        return { status: "SUCCESS", relationshipID };
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
export async function getTreatmentRelationship(relationshipID) {
    let gateway, client;
    try {
        const result = await getContract("hospital");
        gateway = result.gateway;
        client  = result.client;
        const { contract } = result;

        const raw  = await contract.evaluateTransaction("GetTreatmentRelationship", relationshipID);
        const data = JSON.parse(Buffer.from(raw).toString("utf8"));

        return { status: "SUCCESS", data };
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
export async function dischargePatient(relationshipID, doctorID) {
    let gateway, client;
    try {
        const result = await getContract("hospital");
        gateway = result.gateway;
        client  = result.client;
        const { contract } = result;

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
export async function markDormant(relationshipID) {
    let gateway, client;
    try {
        const result = await getContract("hospital");
        gateway = result.gateway;
        client  = result.client;
        const { contract } = result;

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
export async function reactivateTreatmentRelationship(relationshipID) {
    let gateway, client;
    try {
        const result = await getContract("hospital");
        gateway = result.gateway;
        client  = result.client;
        const { contract } = result;

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
