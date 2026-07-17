import express from "express";
import * as svc from "../services/treatmentRelationshipFabricService.js";
import { authenticate, authorizeRoles } from "../services/authMiddleware.js";

const router = express.Router();

/**
 * POST /treatment-relationships
 * Create a treatment relationship between a doctor and patient.
 * Body: { patientID, relationshipType, notes? }
 */
router.post("/", authenticate, authorizeRoles("doctor"), async (req, res) => {
    const { patientID, relationshipType, notes } = req.body;

    if (!patientID || !relationshipType) {
        return res.status(400).json({
            status: "FAILED",
            message: "patientID and relationshipType are required.",
        });
    }

    const result = await svc.createTreatmentRelationship({
        patientID,
        doctorID: req.user.id,
        relationshipType,
        notes,
    });

    return res.status(result.status === "SUCCESS" ? 200 : 500).json(result);
});

/**
 * GET /treatment-relationships/:id
 */
router.get("/:id", authenticate, async (req, res) => {
    const result = await svc.getTreatmentRelationship(req.params.id, req.user.id, req.user.role);
    const statusCode = result.status === "SUCCESS" ? 200 : result.status === "ACCESS_DENIED" ? 403 : 500;
    return res.status(statusCode).json(result);
});

/**
 * PATCH /treatment-relationships/:id/discharge
 * Doctor discharges a patient — revokes access.
 */
router.patch("/:id/discharge", authenticate, authorizeRoles("doctor"), async (req, res) => {
    const result = await svc.dischargePatient(req.params.id, req.user.id);
    const statusCode = result.status === "SUCCESS" ? 200 : result.status === "ACCESS_DENIED" ? 403 : 500;
    return res.status(statusCode).json(result);
});

/**
 * PATCH /treatment-relationships/:id/dormant
 * Mark a relationship as dormant (no activity for 30 days).
 */
router.patch("/:id/dormant", authenticate, authorizeRoles("doctor"), async (req, res) => {
    const result = await svc.markDormant(req.params.id, req.user.id);
    const statusCode = result.status === "SUCCESS" ? 200 : result.status === "ACCESS_DENIED" ? 403 : 500;
    return res.status(statusCode).json(result);
});

/**
 * PATCH /treatment-relationships/:id/reactivate
 * Reactivate a dormant relationship (new appointment scheduled).
 */
router.patch("/:id/reactivate", authenticate, authorizeRoles("doctor"), async (req, res) => {
    const result = await svc.reactivateTreatmentRelationship(req.params.id, req.user.id);
    const statusCode = result.status === "SUCCESS" ? 200 : result.status === "ACCESS_DENIED" ? 403 : 500;
    return res.status(statusCode).json(result);
});
router.get("/", authenticate, async (req, res) => {
    let result;
    if (req.user.role === "doctor") {
        result = await svc.getTreatmentRelationshipsByDoctor(req.user.id);
    } else if (req.user.role === "patient") {
        result = await svc.getTreatmentRelationshipsByPatient(req.user.id);
    } else {
        return res.status(403).json({ status: "ACCESS_DENIED", message: "Only doctors and patients can list treatment relationships." });
    }
    return res.status(result.status === "SUCCESS" ? 200 : 500).json(result);
});
export default router;
