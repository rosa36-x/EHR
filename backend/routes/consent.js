import express from "express";
import * as svc from "../services/consentFabricService.js";

const router = express.Router();

/**
 * POST /consents
 * Body: { consentID, patientID, granteeOrg, resourceType, permission, expiryDate? }
 */
router.post("/", async (req, res) => {
    const { consentID, patientID, granteeOrg, resourceType, permission } = req.body;

    if (!consentID || !patientID || !granteeOrg || !resourceType || !permission) {
        return res.status(400).json({
            status: "FAILED",
            message: "consentID, patientID, granteeOrg, resourceType, permission are required.",
        });
    }

    const result = await svc.grantConsent(req.body);
    return res.status(result.status === "SUCCESS" ? 200 : 500).json(result);
});

/**
 * GET /consents/:id
 * Returns consent metadata from Fabric.
 */
router.get("/:id", async (req, res) => {
    const result = await svc.getConsent(req.params.id);
    return res.status(result.status === "SUCCESS" ? 200 : 500).json(result);
});

/**
 * GET /consents/:id/check
 * Returns whether consent is currently ACTIVE.
 */
router.get("/:id/check", async (req, res) => {
    const result = await svc.checkConsent(req.params.id);
    return res.status(result.status === "SUCCESS" ? 200 : 500).json(result);
});

/**
 * PATCH /consents/:id/revoke
 * Revokes an active consent.
 */
router.patch("/:id/revoke", async (req, res) => {
    const result = await svc.revokeConsent(req.params.id);
    return res.status(result.status === "SUCCESS" ? 200 : 500).json(result);
});

export default router;
