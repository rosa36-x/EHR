import express from "express";
import * as svc from "../services/auditFabricService.js";

const router = express.Router();

/**
 * POST /audits
 * Body: { auditID, actorID, actorRole, action, resourceType, resourceID }
 * AuditID format: AUD0001
 */
router.post("/", async (req, res) => {
    const { auditID, actorID, actorRole, action, resourceType, resourceID } = req.body;

    if (!auditID || !actorID || !actorRole || !action || !resourceType || !resourceID) {
        return res.status(400).json({
            status: "FAILED",
            message: "auditID, actorID, actorRole, action, resourceType, resourceID are required.",
        });
    }

    const result = await svc.createAuditLog(req.body);
    return res.status(result.status === "SUCCESS" ? 200 : 500).json(result);
});

/**
 * GET /audits/:id
 * Only accessible by GovernanceMSP per policy registry.
 */
router.get("/:id", async (req, res) => {
    const result = await svc.getAuditLog(req.params.id);
    return res.status(result.status === "SUCCESS" ? 200 : 500).json(result);
});

export default router;
