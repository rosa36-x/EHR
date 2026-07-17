import { getContract } from "./fabricService.js";
import { logAudit } from "./auditMiddleware.js";
import { registerPatientAuth } from "./authService.js";
import { generateID } from "./idService.js";
import { canAccessRecord } from "./accessControlService.js";
import { PatientAuth } from "./db.js";

export async function createPatient(patientData) {
    let gateway, client;
    try {
        // Check for duplicates BEFORE writing to the ledger — otherwise a
        // rejected duplicate still leaves an orphaned Patient asset on
        // Fabric with no matching Mongo auth record. Checks both phone
        // (already unique on PatientAuth) and aadhaarHash (catches the same
        // real person re-registering under a different phone).
        const existingByPhone = await PatientAuth.findOne({ phone: patientData.phone });
        if (existingByPhone) {
            return { status: "DUPLICATE", message: "A patient is already registered with this phone number." };
        }
        if (patientData.aadhaarHash) {
            const existingByAadhaar = await PatientAuth.findOne({ aadhaarHash: patientData.aadhaarHash });
            if (existingByAadhaar) {
                return { status: "DUPLICATE", message: "This Aadhaar number is already registered to a patient." };
            }
        }

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
        const authResult = await registerPatientAuth(patientID, patientData.phone, patientData.aadhaarHash);
        if (authResult.status !== "SUCCESS") {
            // The ledger write already happened and can't be rolled back
            // here (no delete/void chaincode function exists yet — see
            // docs), but at minimum surface the failure instead of silently
            // returning SUCCESS with no way to ever log in as this patient.
            console.error("[createPatient] Ledger write succeeded but auth registration failed:", authResult.message);
            return { status: "FAILED", message: `Patient written to ledger but auth registration failed: ${authResult.message}` };
        }

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
        // Patient records have no sensitivityLevel concept (demographic data,
        // not a clinical record type) — canAccessRecord's sensitivity branch
        // is simply skipped when it's undefined, leaving self-access +
        // treatment-relationship checks, which is exactly what applies here.
        const access = await canAccessRecord({
            actorID, actorRole,
            patientID,
            resourceID:   patientID,
            resourceType: "PATIENT",
        });
        if (!access.allowed) {
            return { status: access.status, message: access.message };
        }

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
export async function searchPatientsByName(nameSubstring) {
    let gateway, client;
    try {
        const result = await getContract("hospital");
        gateway = result.gateway;
        client  = result.client;
        const { contract } = result;
        const raw = await contract.evaluateTransaction("SearchPatientsByName", nameSubstring);
        return { status: "SUCCESS", data: JSON.parse(Buffer.from(raw).toString("utf8")) ?? [] };
    } catch (err) {
        return { status: "FAILED", message: err.message };
    } finally {
        if (gateway) await gateway.close();
        if (client)  client.close();
    }
}