import crypto from "crypto";
import { getContract } from "./fabricService.js";
import { encryptDocument, decryptDocument } from "./kmsService.js";
import { uploadFile, getFile } from "./ipfsService.js";

/**
 * Create a lab report record.
 * Flow: encrypt doc → upload to IPFS → submit to Fabric (LabReportCollection)
 * Submits as LaboratoryMSP.
 */
export async function createLabReport(data, fileBuffer) {
    let gateway, client;
    try {
        const { encryptedBuffer, keyRef } = await encryptDocument(fileBuffer);
        const reportCID  = await uploadFile(encryptedBuffer);
        const reportHash = crypto
            .createHash("sha256")
            .update(fileBuffer)
            .digest("hex");

        const result = await getContract("laboratory");
        gateway = result.gateway;
        client  = result.client;
        const { contract } = result;

        const timestamp = new Date().toISOString();

        await contract.submitTransaction(
            "CreateLabReport",
            data.reportID,
            data.patientID,
            data.labTechID,
            data.reportType,
            reportCID,
            reportHash,
            keyRef,
            data.status ?? "PENDING",
            timestamp,
            timestamp
        );

        return {
            status:           "SUCCESS",
            reportID:         data.reportID,
            reportCID,
            reportHash,
            encryptionKeyRef: keyRef,
        };
    } catch (err) {
        console.error("[LabReport] createLabReport failed:", err);
        return { status: "FAILED", message: err.message };
    } finally {
        if (gateway) await gateway.close();
        if (client)  client.close();
    }
}

/**
 * Get lab report metadata from Fabric.
 * @param {string} orgName - "hospital" or "laboratory"
 */
export async function getLabReport(reportID, orgName = "laboratory") {
    let gateway, client;
    try {
        const result = await getContract(orgName);
        gateway = result.gateway;
        client  = result.client;
        const { contract } = result;

        const raw  = await contract.evaluateTransaction("GetLabReport", reportID);
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
 * Retrieve and decrypt a lab report document from IPFS.
 * @param {string} orgName - "hospital" or "laboratory"
 */
export async function getLabReportDocument(reportID, orgName = "laboratory") {
    let gateway, client;
    try {
        const result = await getContract(orgName);
        gateway = result.gateway;
        client  = result.client;
        const { contract } = result;

        const raw = await contract.evaluateTransaction("GetLabReport", reportID);
        const { reportCID, encryptionKeyRef } = JSON.parse(
            Buffer.from(raw).toString("utf8")
        );

        const encryptedBuffer = await getFile(reportCID);
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
 * Update a lab report (new document version or status change).
 */
export async function updateLabReport(data, fileBuffer) {
    let gateway, client;
    try {
        const { encryptedBuffer, keyRef } = await encryptDocument(fileBuffer);
        const reportCID  = await uploadFile(encryptedBuffer);
        const reportHash = crypto
            .createHash("sha256")
            .update(fileBuffer)
            .digest("hex");

        const result = await getContract("laboratory");
        gateway = result.gateway;
        client  = result.client;
        const { contract } = result;

        const updatedAt = new Date().toISOString();

        await contract.submitTransaction(
            "UpdateLabReport",
            data.reportID,
            data.reportType,
            reportCID,
            reportHash,
            keyRef,
            data.status ?? "COMPLETED",
            updatedAt
        );

        return {
            status:           "SUCCESS",
            reportID:         data.reportID,
            reportCID,
            reportHash,
            encryptionKeyRef: keyRef,
        };
    } catch (err) {
        return { status: "FAILED", message: err.message };
    } finally {
        if (gateway) await gateway.close();
        if (client)  client.close();
    }
}
