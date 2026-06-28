import { getContract } from "./fabricService.js";
import { logAudit } from "./auditMiddleware.js";
import { notify, NotificationEvents } from "./notificationService.js";
import { PatientAuth, Doctor } from "./db.js";
import { generateID } from "./idService.js";

export async function createEmergencyAccess(data, actorID) {
    let gateway, client;
    try {
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
            data.status ?? "ACTIVE",
            timestamp
        );

        await logAudit({
            actorID:      actorID ?? data.doctorID,
            actorRole:    "doctor",
            action:       "CREATE",
            resourceType: "EMERGENCY_ACCESS",
            resourceID:   data.patientID,
        });

        // Notify patient of emergency access
        const patient = await PatientAuth.findOne({ patientID: data.patientID });
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
        const result = await getContract("hospital");
        gateway = result.gateway;
        client  = result.client;
        const { contract } = result;

        const raw  = await contract.evaluateTransaction("GetEmergencyAccess", emergencyAccessID);
        const data = JSON.parse(Buffer.from(raw).toString("utf8"));

        await logAudit({ actorID, actorRole, action: "READ", resourceType: "EMERGENCY_ACCESS", resourceID: emergencyAccessID });

        return { status: "SUCCESS", data };
    } catch (err) {
        return { status: "FAILED", message: err.message };
    } finally {
        if (gateway) await gateway.close();
        if (client)  client.close();
    }
}
