import { getContract } from "./fabricService.js";

/**
 * Create an emergency access record on the public ledger.
 * EmergencyAccessID format: EA0001, EA0002, ...
 */
export async function createEmergencyAccess(data) {
    let gateway, client;
    try {
        const result = await getContract("hospital");
        gateway = result.gateway;
        client  = result.client;
        const { contract } = result;

        const timestamp = new Date().toISOString();

        await contract.submitTransaction(
            "CreateEmergencyAccess",
            data.emergencyAccessID,
            data.patientID,
            data.doctorID,
            data.reason,
            data.status ?? "ACTIVE",
            timestamp
        );

        return { status: "SUCCESS", emergencyAccessID: data.emergencyAccessID };
    } catch (err) {
        console.error("[Emergency] createEmergencyAccess failed:", err);
        return { status: "FAILED", message: err.message };
    } finally {
        if (gateway) await gateway.close();
        if (client)  client.close();
    }
}

/**
 * Get an emergency access record from the public ledger.
 */
export async function getEmergencyAccess(emergencyAccessID) {
    let gateway, client;
    try {
        const result = await getContract("hospital");
        gateway = result.gateway;
        client  = result.client;
        const { contract } = result;

        const raw  = await contract.evaluateTransaction("GetEmergencyAccess", emergencyAccessID);
        const data = JSON.parse(Buffer.from(raw).toString("utf8"));

        return { status: "SUCCESS", data };
    } catch (err) {
        return { status: "FAILED", message: err.message };
    } finally {
        if (gateway) await gateway.close();
        if (client)  client.close();
    }
}
