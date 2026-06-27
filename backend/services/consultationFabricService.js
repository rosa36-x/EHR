import crypto from "crypto";
import { getContract } from "./fabricService.js";
import { encryptDocument, decryptDocument } from "./kmsService.js";
import { uploadFile, getFile } from "./ipfsService.js";

/**
 * Create a consultation record.
 * Flow: encrypt doc → upload to IPFS → submit to Fabric
 *
 * @param {object} data - Consultation metadata
 * @param {Buffer} fileBuffer - Raw consultation document
 */
export async function createConsultation(data, fileBuffer) {
    let gateway, client;
    try {
        // Step 1: Encrypt document
        const { encryptedBuffer, keyRef } = await encryptDocument(fileBuffer);

        // Step 2: Upload encrypted file to IPFS
        const consultationCID = await uploadFile(encryptedBuffer);

        // Step 3: Compute SHA-256 hash of original (plaintext) document
        const consultationHash = crypto
            .createHash("sha256")
            .update(fileBuffer)
            .digest("hex");

        // Step 4: Submit to Fabric
        const result = await getContract("hospital");
        gateway = result.gateway;
        client  = result.client;
        const { contract } = result;

        const timestamp = new Date().toISOString();

        await contract.submitTransaction(
            "CreateConsultation",
            data.consultationID,
            data.patientID,
            data.doctorID,
            data.diagnosis,
            consultationCID,
            consultationHash,
            keyRef,
            timestamp,
            timestamp,
            timestamp
        );

        return {
            status:          "SUCCESS",
            consultationID:  data.consultationID,
            consultationCID,
            consultationHash,
            encryptionKeyRef: keyRef,
        };
    } catch (err) {
        console.error("[Consultation] createConsultation failed:", err);
        return { status: "FAILED", message: err.message };
    } finally {
        if (gateway) await gateway.close();
        if (client)  client.close();
    }
}

/**
 * Get consultation metadata from Fabric.
 */
export async function getConsultation(consultationID) {
    let gateway, client;
    try {
        const result = await getContract("hospital");
        gateway = result.gateway;
        client  = result.client;
        const { contract } = result;

        const raw = await contract.evaluateTransaction("GetConsultation", consultationID);
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
 * Retrieve and decrypt a consultation document from IPFS.
 * Flow: get CID from Fabric → download from IPFS → decrypt
 *
 * @returns {Buffer} plaintext document
 */
export async function getConsultationDocument(consultationID) {
    let gateway, client;
    try {
        const result = await getContract("hospital");
        gateway = result.gateway;
        client  = result.client;
        const { contract } = result;

        const raw = await contract.evaluateTransaction("GetConsultation", consultationID);
        const { consultationCID, encryptionKeyRef } = JSON.parse(
            Buffer.from(raw).toString("utf8")
        );

        const encryptedBuffer = await getFile(consultationCID);
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
 * Update a consultation record with a new document.
 */
export async function updateConsultation(data, fileBuffer) {
    let gateway, client;
    try {
        const { encryptedBuffer, keyRef } = await encryptDocument(fileBuffer);
        const consultationCID = await uploadFile(encryptedBuffer);
        const consultationHash = crypto
            .createHash("sha256")
            .update(fileBuffer)
            .digest("hex");

        const result = await getContract("hospital");
        gateway = result.gateway;
        client  = result.client;
        const { contract } = result;

        const updatedAt = new Date().toISOString();

        await contract.submitTransaction(
            "UpdateConsultation",
            data.consultationID,
            data.diagnosis,
            consultationCID,
            consultationHash,
            keyRef,
            updatedAt
        );

        return {
            status:          "SUCCESS",
            consultationID:  data.consultationID,
            consultationCID,
            consultationHash,
            encryptionKeyRef: keyRef,
        };
    } catch (err) {
        return { status: "FAILED", message: err.message };
    } finally {
        if (gateway) await gateway.close();
        if (client)  client.close();
    }
}
