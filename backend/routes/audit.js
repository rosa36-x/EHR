import express from "express";
import * as svc from "../services/auditFabricService.js";
import { authenticate, authorizeRoles } from "../services/authMiddleware.js";

const router = express.Router();

/**
 * POST /audits
 * Body: { auditID, action, resourceType, resourceID }
 * actorID/actorRole are taken from the authenticated token, never trusted from
 * the request body — otherwise any caller could forge audit log attribution.
 * AuditID format: AUD0001
 */
router.post("/", authenticate, async (req, res) => {
    const { auditID, action, resourceType, resourceID } = req.body;

    if (!auditID || !action || !resourceType || !resourceID) {
        return res.status(400).json({
            status: "FAILED",
            message: "auditID, action, resourceType, resourceID are required.",
        });
    }

    const result = await svc.createAuditLog({
        auditID,
        actorID:   req.user.id,
        actorRole: req.user.role,
        action,
        resourceType,
        resourceID,
    });
    return res.status(result.status === "SUCCESS" ? 200 : 500).json(result);
});

/**
 * GET /audits/:id
 * NOTE: the policy registry restricts GET_AUDIT_LOG to GovernanceMSP/HospitalMSP
 * at the chaincode layer, but the app's user model only has "doctor" and
 * "patient" roles — there is no "governance" actor role to check here.
 * For now this only requires a valid, authenticated doctor. If patients need
 * to see audit entries about their own records, use /audit-history/:auditID
 * instead (routes/auditHistory.js), which already has that ownership check.
 */
router.get("/:id", authenticate, authorizeRoles("doctor"), async (req, res) => {
    const result = await svc.getAuditLog(req.params.id);
    return res.status(result.status === "SUCCESS" ? 200 : 500).json(result);
});

export default router;
