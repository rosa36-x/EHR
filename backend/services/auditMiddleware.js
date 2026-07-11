import { getContract } from "./fabricService.js";
import { generateID } from "./idService.js";
import { AuditLogMirror } from "./db.js";

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
 * @param {string} [params.actorOrg]   - MSP ID of the org the actor called
 *                                        through (e.g. "PharmacyMSP"), for
 *                                        cross-org access. Defaults to "" —
 *                                        existing callers are unaffected.
 * @returns {Promise<string|null>} the generated auditID on success, or null
 *   if the chaincode write failed (audit failures never throw — callers
 *   that need to link something to this entry, e.g. anomalyDetectionService,
 *   should treat null as "couldn't establish an on-chain link this time").
 */
export async function logAudit({ actorID, actorRole, action, resourceType, resourceID, actorOrg = "" }) {
    let gateway, client;
    const auditID   = generateID("audit");
    const timestamp = new Date().toISOString();
    try {
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
            timestamp,
            actorOrg
        );

        // Best-effort Mongo mirror — see AuditLogMirror's schema comment in
        // db.js for why this exists (chaincode has no bulk/range query).
        // The ledger write above already succeeded; a mirror failure here
        // must never be treated as an audit failure.
        try {
            await new AuditLogMirror({
                auditID, actorID, actorRole, actorOrg, action, resourceType, resourceID, timestamp,
            }).save();
        } catch (mirrorErr) {
            console.error("[Audit] Failed to write AuditLogMirror (ledger write still succeeded):", mirrorErr.message);
        }

        return auditID;
    } catch (err) {
        // Audit failures must never crash the main flow
        console.error("[Audit] Failed to log audit event:", err.message);
        return null;
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