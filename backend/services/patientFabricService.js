import { getContract } from "./fabricService.js";
import { logAudit } from "./auditMiddleware.js";
import { registerPatientAuth } from "./authService.js";
import { generateID } from "./idService.js";

export async function createPatient(patientData) {
    let gateway, client;
    try {
        const result = await getContract("hospital");
        gateway = result.gateway;
        client  = result.client;
        const { contract } = result;

        // Generate patientID server-side
        const patientID = generateID("patient");
        const timestamp = new Date().toISOString();

        await contract.submitTransaction(
            "CreatePatient",
            patientID,
            patientData.fullName,
            patientData.dob,
            patientData.gender,
            patientData.aadhaarVID,
            patientData.aadhaarToken,
            patientData.phone,
            patientData.email,
            timestamp,
            timestamp
        );

        // Register patient auth record in MongoDB for login
        await registerPatientAuth(patientID, patientData.phone);

        await logAudit({
            actorID:      "SYSTEM",
            actorRole:    "system",
            action:       "CREATE",
            resourceType: "PATIENT",
            resourceID:   patientID,
        });

        return {
            status:       "SUCCESS",
            patientID,
            aadhaarVID:   patientData.aadhaarVID,
            aadhaarToken: patientData.aadhaarToken,
            message:      "Patient successfully written to Fabric ledger",
        };
    } catch (err) {
        console.error("Fabric submitTransaction failed:", err);
        return { status: "FAILED", message: err.message };
    } finally {
        if (gateway) await gateway.close();
        if (client)  client.close();
    }
}

export async function getPatient(patientID, actorID, actorRole) {
    let gateway, client;
    try {
        const result = await getContract("hospital");
        gateway = result.gateway;
        client  = result.client;
        const { contract } = result;

        const raw  = await contract.evaluateTransaction("GetPatient", patientID);
        const data = JSON.parse(Buffer.from(raw).toString("utf8"));

        await logAudit({
            actorID:      actorID ?? "SYSTEM",
            actorRole:    actorRole ?? "system",
            action:       "READ",
            resourceType: "PATIENT",
            resourceID:   patientID,
        });

        return { status: "SUCCESS", data };
    } catch (err) {
        return { status: "FAILED", message: err.message };
    } finally {
        if (gateway) await gateway.close();
        if (client)  client.close();
    }
}
