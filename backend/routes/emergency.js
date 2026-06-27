import express from "express";
import * as svc from "../services/emergencyFabricService.js";

const router = express.Router();

/**
 * POST /emergency-access
 * Body: { emergencyAccessID, patientID, doctorID, reason }
 * EmergencyAccessID format: EA0001
 */
router.post("/", async (req, res) => {
    const { emergencyAccessID, patientID, doctorID, reason } = req.body;

    if (!emergencyAccessID || !patientID || !doctorID || !reason) {
        return res.status(400).json({
            status: "FAILED",
            message: "emergencyAccessID, patientID, doctorID, reason are required.",
        });
    }

    const result = await svc.createEmergencyAccess(req.body);
    return res.status(result.status === "SUCCESS" ? 200 : 500).json(result);
});

/**
 * GET /emergency-access/:id
 */
router.get("/:id", async (req, res) => {
    const result = await svc.getEmergencyAccess(req.params.id);
    return res.status(result.status === "SUCCESS" ? 200 : 500).json(result);
});

export default router;
