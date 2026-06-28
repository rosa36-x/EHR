import express from "express";
import { getContract } from "../services/fabricService.js";
import { authenticate, authorizeRoles } from "../middleware/authMiddleware.js";

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

        // Patients can only view audit logs for their own records
        if (req.user.role === "patient" && data.resourceID !== req.user.id) {
            return res.status(403).json({
                status:  "FAILED",
                message: "Access denied. You can only view your own audit history.",
            });
        }

        return res.json({ status: "SUCCESS", data });
    } catch (err) {
        return res.status(500).json({ status: "FAILED", message: err.message });
    } finally {
        if (gateway) await gateway.close();
        if (client)  client.close();
    }
});

export default router;