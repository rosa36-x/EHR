import express from "express";
import * as svc from "../services/emergencyFabricService.js";
import { authenticate, authorizeRoles } from "../services/authMiddleware.js";

const router = express.Router();

/**
 * POST /emergency-access
 * Body: { emergencyAccessID, patientID, doctorID, reason }
 * EmergencyAccessID format: EA0001
 */
router.post("/", authenticate, authorizeRoles("doctor"), async (req, res) => {
    const { emergencyAccessID, patientID, doctorID, reason } = req.body;

    if (!emergencyAccessID || !patientID || !doctorID || !reason) {
        return res.status(400).json({
            status: "FAILED",
            message: "emergencyAccessID, patientID, doctorID, reason are required.",
        });
    }

    // A doctor can only open emergency access under their own identity — the
    // body's doctorID is ignored so nobody can name a different doctor as
    // the one gaining access. req.user.id is the source of truth.
    const result = await svc.createEmergencyAccess(
        { ...req.body, doctorID: req.user.id },
        req.user.id
    );
    return res.status(result.status === "SUCCESS" ? 200 : 500).json(result);
});

/**
 * GET /emergency-access/:id
 */
router.get("/:id", authenticate, async (req, res) => {
    const result = await svc.getEmergencyAccess(req.params.id, req.user.id, req.user.role);
    const statusCode = result.status === "SUCCESS" ? 200 : result.status === "ACCESS_DENIED" ? 403 : 500;
    return res.status(statusCode).json(result);
});

/**
 * PATCH /emergency-access/:id/close
 * Explicitly ends an emergency access episode — revokes the doctor's access
 * immediately rather than waiting on the 24-hour safety-net expiry.
 */
router.patch("/:id/close", authenticate, authorizeRoles("doctor"), async (req, res) => {
    const result = await svc.closeEmergencyAccess(req.params.id, req.user.id, req.user.role);
    const statusCode = result.status === "SUCCESS" ? 200 : result.status === "ACCESS_DENIED" ? 403 : 500;
    return res.status(statusCode).json(result);
});

export default router;
