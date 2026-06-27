import crypto from "crypto";
import { getContract } from "./fabricService.js";
import { encryptDocument, decryptDocument } from "./kmsService.js";
import { uploadFile, getFile } from "./ipfsService.js";

/**
 * Create a referral record.
 * Flow: encrypt doc → upload to IPFS → submit to Fabric (public state)
 */
export async function createReferral(data, fileBuffer) {
    let gateway, client;
    try {
        const { encryptedBuffer, keyRef } = await encryptDocument(fileBuffer);
        const referralCID  = await uploadFile(encryptedBuffer);
        const referralHash = crypto
            .createHash("sha256")
            .update(fileBuffer)
            .digest("hex");

        const result = await getContract("hospital");
        gateway = result.gateway;
        client  = result.client;
        const { contract } = result;

        const timestamp = new Date().toISOString();

        await contract.submitTransaction(
            "CreateReferral",
            data.referralID,
            data.patientID,
            data.fromDoctorID,
            data.toDoctorID,
            referralCID,
            referralHash,
            keyRef,
            data.referralReason,
            timestamp,
            timestamp
        );

        return {
            status:           "SUCCESS",
            referralID:       data.referralID,
            referralCID,
            referralHash,
            encryptionKeyRef: keyRef,
        };
    } catch (err) {
        console.error("[Referral] createReferral failed:", err);
        return { status: "FAILED", message: err.message };
    } finally {
        if (gateway) await gateway.close();
        if (client)  client.close();
    }
}

/**
 * Get referral metadata from Fabric.
 */
export async function getReferral(referralID) {
    let gateway, client;
    try {
        const result = await getContract("hospital");
        gateway = result.gateway;
        client  = result.client;
        const { contract } = result;

        const raw  = await contract.evaluateTransaction("GetReferral", referralID);
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
 * Retrieve and decrypt a referral document from IPFS.
 */
export async function getReferralDocument(referralID) {
    let gateway, client;
    try {
        const result = await getContract("hospital");
        gateway = result.gateway;
        client  = result.client;
        const { contract } = result;

        const raw = await contract.evaluateTransaction("GetReferral", referralID);
        const { referralCID, encryptionKeyRef } = JSON.parse(
            Buffer.from(raw).toString("utf8")
        );

        const encryptedBuffer = await getFile(referralCID);
        const plaintext       = await decryptDocument(encryptedBuffer, encryptionKeyRef);

        return { status: "SUCCESS", document: plaintext };
    } catch (err) {
        return { status: "FAILED", message: err.message };
    } finally {
        if (gateway) await gateway.close();
        if (client)  client.close();
    }
}
