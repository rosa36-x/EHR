import express from "express";
import * as svc from "../services/permissionRequestFabricService.js";
import { authenticate, authorizeRoles } from "../middleware/authMiddleware.js";

const router = express.Router();

/**
 * POST /permission-requests
 * Doctor requests access to a sensitive record.
 * Body: { patientID, resourceType, resourceID, reason }
 */
router.post("/", authenticate, authorizeRoles("doctor"), async (req, res) => {
    const { patientID, resourceType, resourceID, reason } = req.body;

    if (!patientID || !resourceType || !resourceID || !reason) {
        return res.status(400).json({
            status: "FAILED",
            message: "patientID, resourceType, resourceID, reason are required.",
        });
    }

    const result = await svc.createPermissionRequest({
        patientID,
        doctorID: req.user.id,
        resourceType,
        resourceID,
        reason,
    });

    return res.status(result.status === "SUCCESS" ? 200 : 500).json(result);
});

/**
 * GET /permission-requests/:id
 * Get a permission request record.
 */
router.get("/:id", authenticate, async (req, res) => {
    const result = await svc.getPermissionRequest(req.params.id);
    return res.status(result.status === "SUCCESS" ? 200 : 500).json(result);
});

/**
 * PATCH /permission-requests/:id/approve
 * Patient approves a permission request.
 */
router.patch("/:id/approve", authenticate, authorizeRoles("patient"), async (req, res) => {
    const result = await svc.approvePermissionRequest(req.params.id, req.user.id);
    return res.status(result.status === "SUCCESS" ? 200 : 500).json(result);
});

/**
 * PATCH /permission-requests/:id/reject
 * Patient rejects a permission request.
 */
router.patch("/:id/reject", authenticate, authorizeRoles("patient"), async (req, res) => {
    const result = await svc.rejectPermissionRequest(req.params.id, req.user.id);
    return res.status(result.status === "SUCCESS" ? 200 : 500).json(result);
});

export default router;
