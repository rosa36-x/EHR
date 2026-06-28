import { getContract } from "./fabricService.js";
import { generateID } from "./idService.js";

export async function createAuditLog(data) {
    let gateway, client;
    try {
        const auditID = generateID("audit");

        const result = await getContract("governance");
        gateway = result.gateway;
        client  = result.client;
        const { contract } = result;

        const timestamp = new Date().toISOString();

        await contract.submitTransaction(
            "CreateAuditLog",
            auditID,
            data.actorID,
            data.actorRole,
            data.action,
            data.resourceType,
            data.resourceID,
            timestamp
        );

        return { status: "SUCCESS", auditID };
    } catch (err) {
        console.error("[Audit] createAuditLog failed:", err);
        return { status: "FAILED", message: err.message };
    } finally {
        if (gateway) await gateway.close();
        if (client)  client.close();
    }
}

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
