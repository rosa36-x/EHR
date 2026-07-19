import express from "express";
import { getContract } from "../services/fabricService.js";
import { authenticate, authorizeRoles, requireOrgActorOrg } from "../services/authMiddleware.js";
import { AuditLogMirror } from "../services/db.js";
const router = express.Router();
/**
 * GET /audit-history/all?org=&actorId=&action=&from=&to=&page=&limit=
 * System-wide audit explorer for Governance — all orgs, all actors,
 * filterable by org/action/date range.
 *
 * Reads from AuditLogMirror, not the ledger — see the schema comment in
 * db.js for why (chaincode has no bulk/range query). Mirror is best-effort;
 * ledger remains the source of truth for anything compliance-critical.
 *
 * v1: no actor-name resolution (patient names live on Fabric only, not
 * Mongo) — frontend shows actorRole + actorID. Revisit if needed.
 */
router.get("/all", authenticate, requireOrgActorOrg("GovernanceMSP"), async (req, res) => {
    try {
        const { org, actorId, action, from, to, page = 1, limit = 50 } = req.query;
        const filter = {};
        if (org)     filter.actorOrg = org;
        if (actorId) filter.actorID  = actorId;
        if (action)  filter.action   = action;
        if (from || to) {
        filter.timestamp = {
            ...(from && { $gte: new Date(from).toISOString() }),
            ...(to   && { $lte: new Date(`${to}T23:59:59.999Z`).toISOString() }),
        };
    }


        const logs = await AuditLogMirror.find(filter)
            .sort({ timestamp: -1 })
            .skip((page - 1) * limit)
            .limit(Number(limit));

        return res.json({ status: "SUCCESS", data: logs, page: Number(page), limit: Number(limit) });
    } catch (err) {
        return res.status(500).json({ status: "FAILED", message: err.message });
    }
});

/**
 * GET /audit-history/:auditID
 * Get a single audit log entry.
 * Accessible by governance org and patients (their own records).
 */
router.get("/:auditID", authenticate, async (req, res) => {
    let gateway, client;
    try {
        const result = await getContract("governance");
        gateway = result.gateway;
        client  = result.client;
        const { contract } = result;

        const raw  = await contract.evaluateTransaction("GetAuditLog", req.params.auditID);
        const data = JSON.parse(Buffer.from(raw).toString("utf8"));

        // Patients can view audit logs where:
        //   (a) they were the actor (actorID matches their ID), OR
        //   (b) the audited resource belongs to them (resourceID matches their patientID)
        // This correctly covers "someone accessed MY record" audit events.
        if (req.user.role === "patient") {
            const isOwnAction   = data.actorID    === req.user.id;
            const isOwnResource = data.resourceID === req.user.id;
            if (!isOwnAction && !isOwnResource) {
                return res.status(403).json({
                    status:  "FAILED",
                    message: "Access denied. You can only view audit history for your own records.",
                });
            }
        }

        return res.json({ status: "SUCCESS", data });
    } catch (err) {
        return res.status(500).json({ status: "FAILED", message: err.message });
    } finally {
        if (gateway) await gateway.close();
        if (client)  client.close();
    }
});
/**
 * GET /audit-history?patientID=...
 * List audit entries for the logged-in patient (their own actions and
 * anything done to their records), or for the logged-in doctor.
 */
router.get("/", authenticate, async (req, res) => {
    let gateway, client;
    try {
        const result = await getContract("governance");
        gateway = result.gateway;
        client  = result.client;
        const { contract } = result;

        const fn = req.user.role === "doctor" ? "GetAuditLogsByActor" : "GetAuditLogsByActor";
        const raw = await contract.evaluateTransaction(fn, req.user.id);
        const data = JSON.parse(Buffer.from(raw).toString("utf8")) ?? [];

        return res.json({ status: "SUCCESS", data });
    } catch (err) {
        return res.status(500).json({ status: "FAILED", message: err.message });
    } finally {
        if (gateway) await gateway.close();
        if (client)  client.close();
    }
});
export default router;