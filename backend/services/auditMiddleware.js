import { getContract } from "./fabricService.js";
import { generateID } from "./idService.js";

/**
 * Audit Middleware
 *
 * Automatically logs every record access and mutation to the Fabric ledger.
 * Called by all fabric service functions after every evaluateTransaction
 * or submitTransaction — successful or failed.
 *
 * Log format matches AuditLog schema:
 * auditID, actorID, actorRole, action, resourceType, resourceID, timestamp
 *
 * Actions:
 * - READ         — evaluateTransaction (get)
 * - CREATE       — submitTransaction (create)
 * - UPDATE       — submitTransaction (update)
 * - ACCESS_DENIED — policy check failed
 * - ACCESS_FAILED — any other error
 */

/**
 * Log an audit event to the Fabric ledger.
 *
 * @param {object} params
 * @param {string} params.actorID      - doctorID or patientID
 * @param {string} params.actorRole    - "doctor" | "patient" | "system"
 * @param {string} params.action       - READ | CREATE | UPDATE | ACCESS_DENIED | ACCESS_FAILED
 * @param {string} params.resourceType - e.g. "CONSULTATION", "PRESCRIPTION"
 * @param {string} params.resourceID   - the record ID being accessed
 */
export async function logAudit({ actorID, actorRole, action, resourceType, resourceID }) {
    let gateway, client;
    try {
        const auditID   = generateID("audit");
        const timestamp = new Date().toISOString();

        const result = await getContract("governance");
        gateway = result.gateway;
        client  = result.client;
        const { contract } = result;

        await contract.submitTransaction(
            "CreateAuditLog",
            auditID,
            actorID,
            actorRole,
            action,
            resourceType,
            resourceID,
            timestamp
        );
    } catch (err) {
        // Audit failures must never crash the main flow
        console.error("[Audit] Failed to log audit event:", err.message);
    } finally {
        if (gateway) await gateway.close();
        if (client)  client.close();
    }
}

/**
 * Wrap a fabric service call with automatic audit logging.
 * Use this in service functions instead of calling logAudit manually.
 *
 * @param {object} auditParams - { actorID, actorRole, action, resourceType, resourceID }
 * @param {Function} fn        - async function to execute
 * @returns result of fn()
 */
export async function withAudit(auditParams, fn) {
    let result;
    try {
        result = await fn();

        // Log successful access
        await logAudit({
            ...auditParams,
            action: result?.status === "SUCCESS"
                ? auditParams.action
                : "ACCESS_FAILED",
        });

        return result;
    } catch (err) {
        // Log failed access
        await logAudit({
            ...auditParams,
            action: "ACCESS_FAILED",
        });
        throw err;
    }
}