import crypto from "crypto";
import { getContract } from "./fabricService.js";
import { encryptDocument, decryptDocument } from "./kmsService.js";
import { uploadFile, getFile } from "./ipfsService.js";

/**
 * Create a prescription record.
 * Flow: encrypt doc → upload to IPFS → submit to Fabric (PrescriptionCollection)
 * Submits as HospitalMSP — OR policy means one endorser is sufficient.
 */
export async function createPrescription(data, fileBuffer) {
    let gateway, client;
    try {
        const { encryptedBuffer, keyRef } = await encryptDocument(fileBuffer);
        const prescriptionCID  = await uploadFile(encryptedBuffer);
        const prescriptionHash = crypto
            .createHash("sha256")
            .update(fileBuffer)
            .digest("hex");

        const result = await getContract("hospital");
        gateway = result.gateway;
        client  = result.client;
        const { contract } = result;

        const timestamp = new Date().toISOString();

        await contract.submitTransaction(
            "CreatePrescription",
            data.prescriptionID,
            data.patientID,
            data.doctorID,
            prescriptionCID,
            prescriptionHash,
            keyRef,
            data.status ?? "ISSUED",
            data.issuedAt ?? timestamp,
            data.dispensedAt ?? "",
            timestamp,
            timestamp
        );

        return {
            status:           "SUCCESS",
            prescriptionID:   data.prescriptionID,
            prescriptionCID,
            prescriptionHash,
            encryptionKeyRef: keyRef,
        };
    } catch (err) {
        console.error("[Prescription] createPrescription failed:", err);
        return { status: "FAILED", message: err.message };
    } finally {
        if (gateway) await gateway.close();
        if (client)  client.close();
    }
}

/**
 * Get prescription metadata from Fabric.
 * @param {string} orgName - "hospital" or "pharmacy"
 */
export async function getPrescription(prescriptionID, orgName = "hospital") {
    let gateway, client;
    try {
        const result = await getContract(orgName);
        gateway = result.gateway;
        client  = result.client;
        const { contract } = result;

        const raw  = await contract.evaluateTransaction("GetPrescription", prescriptionID);
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
 * Retrieve and decrypt a prescription document from IPFS.
 * @param {string} orgName - "hospital" or "pharmacy"
 */
export async function getPrescriptionDocument(prescriptionID, orgName = "hospital") {
    let gateway, client;
    try {
        const result = await getContract(orgName);
        gateway = result.gateway;
        client  = result.client;
        const { contract } = result;

        const raw = await contract.evaluateTransaction("GetPrescription", prescriptionID);
        const { prescriptionCID, encryptionKeyRef } = JSON.parse(
            Buffer.from(raw).toString("utf8")
        );

        const encryptedBuffer = await getFile(prescriptionCID);
        const plaintext       = await decryptDocument(encryptedBuffer, encryptionKeyRef);

        return { status: "SUCCESS", document: plaintext };
    } catch (err) {
        return { status: "FAILED", message: err.message };
    } finally {
        if (gateway) await gateway.close();
        if (client)  client.close();
    }
}

/**
 * Update prescription status (e.g. ISSUED → DISPENSED).
 * Can be called by hospital or pharmacy.
 * @param {string} orgName - "hospital" or "pharmacy"
 */
export async function updatePrescriptionStatus(prescriptionID, status, dispensedAt, orgName = "hospital") {
    let gateway, client;
    try {
        const result = await getContract(orgName);
        gateway = result.gateway;
        client  = result.client;
        const { contract } = result;

        const updatedAt = new Date().toISOString();

        await contract.submitTransaction(
            "UpdatePrescriptionStatus",
            prescriptionID,
            status,
            dispensedAt ?? "",
            updatedAt
        );

        return { status: "SUCCESS", prescriptionID };
    } catch (err) {
        return { status: "FAILED", message: err.message };
    } finally {
        if (gateway) await gateway.close();
        if (client)  client.close();
    }
}
