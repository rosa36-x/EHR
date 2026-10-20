import express from "express";
import * as svc from "../services/treatmentRelationshipFabricService.js";
import { authenticate, authorizeRoles } from "../services/authMiddleware.js";

const router = express.Router();

/**
 * POST /treatment-relationships
 * Doctor requests a treatment relationship with a patient. It is created
 * PENDING and grants no access until the patient approves it (PATCH
 * /:id/approve). ASSIGNED_EMERGENCY_PHYSICIAN is rejected here (403): it can
 * only be created through POST /emergency-access.
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

    const statusCode = result.status === "SUCCESS" ? 200 : result.status === "ACCESS_DENIED" ? 403 : 500;
    return res.status(statusCode).json(result);
});

/**
 * PATCH /treatment-relationships/:id/approve
 * Patient approves a PENDING relationship (new, or a renewal request).
 * Until then the doctor has no access.
 */
router.patch("/:id/approve", authenticate, authorizeRoles("patient"), async (req, res) => {
    const result = await svc.approveTreatmentRelationship(req.params.id, req.user.id);
    const statusCode = result.status === "SUCCESS" ? 200 : result.status === "ACCESS_DENIED" ? 403 : 500;
    return res.status(statusCode).json(result);
});

/**
 * PATCH /treatment-relationships/:id/reject
 * Patient rejects a PENDING relationship (it is discharged, terminal).
 */
router.patch("/:id/reject", authenticate, authorizeRoles("patient"), async (req, res) => {
    const result = await svc.rejectTreatmentRelationship(req.params.id, req.user.id);
    const statusCode = result.status === "SUCCESS" ? 200 : result.status === "ACCESS_DENIED" ? 403 : 500;
    return res.status(statusCode).json(result);
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
 * Doctor asks to resume a dormant/expired relationship. Sets it PENDING;
 * the patient must approve before access resumes.
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
