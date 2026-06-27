import { getContract } from "./fabricService.js";

/**
 * Grant consent for a patient resource.
 */
export async function grantConsent(data) {
    let gateway, client;
    try {
        const result = await getContract("hospital");
        gateway = result.gateway;
        client  = result.client;
        const { contract } = result;

        const timestamp = new Date().toISOString();

        await contract.submitTransaction(
            "GrantConsent",
            data.consentID,
            data.patientID,
            data.granteeOrg,
            data.resourceType,
            data.permission,
            data.status ?? "ACTIVE",
            data.expiryDate ?? "",
            timestamp,
            timestamp
        );

        return { status: "SUCCESS", consentID: data.consentID };
    } catch (err) {
        console.error("[Consent] grantConsent failed:", err);
        return { status: "FAILED", message: err.message };
    } finally {
        if (gateway) await gateway.close();
        if (client)  client.close();
    }
}

/**
 * Get consent record from Fabric.
 */
export async function getConsent(consentID) {
    let gateway, client;
    try {
        const result = await getContract("hospital");
        gateway = result.gateway;
        client  = result.client;
        const { contract } = result;

        const raw  = await contract.evaluateTransaction("GetConsent", consentID);
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
 * Check whether a consent record is ACTIVE.
 * Returns boolean active field.
 */
export async function checkConsent(consentID) {
    let gateway, client;
    try {
        const result = await getContract("hospital");
        gateway = result.gateway;
        client  = result.client;
        const { contract } = result;

        const raw    = await contract.evaluateTransaction("CheckConsent", consentID);
        const active = Buffer.from(raw).toString("utf8") === "true";

        return { status: "SUCCESS", active };
    } catch (err) {
        return { status: "FAILED", message: err.message };
    } finally {
        if (gateway) await gateway.close();
        if (client)  client.close();
    }
}

/**
 * Revoke an existing consent record.
 */
export async function revokeConsent(consentID) {
    let gateway, client;
    try {
        const result = await getContract("hospital");
        gateway = result.gateway;
        client  = result.client;
        const { contract } = result;

        const updatedAt = new Date().toISOString();

        await contract.submitTransaction("RevokeConsent", consentID, updatedAt);

        return { status: "SUCCESS", consentID };
    } catch (err) {
        return { status: "FAILED", message: err.message };
    } finally {
        if (gateway) await gateway.close();
        if (client)  client.close();
    }
}
