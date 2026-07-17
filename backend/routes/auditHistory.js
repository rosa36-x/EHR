import express from "express";
import { getContract } from "../services/fabricService.js";
import { authenticate, authorizeRoles } from "../services/authMiddleware.js";

const router = express.Router();

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