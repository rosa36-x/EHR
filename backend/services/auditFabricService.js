import { getContract } from "./fabricService.js";

/**
 * Create an audit log entry on the public ledger.
 * AuditID format: AUD0001, AUD0002, ...
 */
export async function createAuditLog(data) {
    let gateway, client;
    try {
        // Governance org submits audit logs per policy registry
        const result = await getContract("governance");
        gateway = result.gateway;
        client  = result.client;
        const { contract } = result;

        const timestamp = new Date().toISOString();

        await contract.submitTransaction(
            "CreateAuditLog",
            data.auditID,
            data.actorID,
            data.actorRole,
            data.action,
            data.resourceType,
            data.resourceID,
            timestamp
        );

        return { status: "SUCCESS", auditID: data.auditID };
    } catch (err) {
        console.error("[Audit] createAuditLog failed:", err);
        return { status: "FAILED", message: err.message };
    } finally {
        if (gateway) await gateway.close();
        if (client)  client.close();
    }
}

/**
 * Get an audit log entry from the public ledger.
 * Only GovernanceMSP is authorized per policy registry.
 */
export async function getAuditLog(auditID) {
    let gateway, client;
    try {
        const result = await getContract("governance");
        gateway = result.gateway;
        client  = result.client;
        const { contract } = result;

        const raw  = await contract.evaluateTransaction("GetAuditLog", auditID);
        const data = JSON.parse(Buffer.from(raw).toString("utf8"));

        return { status: "SUCCESS", data };
    } catch (err) {
        return { status: "FAILED", message: err.message };
    } finally {
        if (gateway) await gateway.close();
        if (client)  client.close();
    }
}
