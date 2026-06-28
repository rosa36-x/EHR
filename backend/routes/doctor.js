import express from "express";
import * as svc from "../services/doctorService.js";
import { authenticate, authorizeRoles } from "../middleware/authMiddleware.js";

const router = express.Router();

/**
 * POST /doctors/register
 * Register a new doctor. doctorID auto-generated.
 * Body: { fullName, licenseNumber, specialization, hospitalID, phone, email, password }
 */
router.post("/register", async (req, res) => {
    const { fullName, licenseNumber, specialization, hospitalID, phone, email, password } = req.body;

    if (!fullName || !licenseNumber || !specialization || !hospitalID || !phone || !email || !password) {
        return res.status(400).json({
            status: "FAILED",
            message: "fullName, licenseNumber, specialization, hospitalID, phone, email, password are required.",
        });
    }

    const result = await svc.createDoctor(req.body);
    return res.status(result.status === "SUCCESS" ? 200 : 400).json(result);
});

/**
 * GET /doctors/:id
 * Get doctor profile by doctorID.
 */
router.get("/:id", authenticate, async (req, res) => {
    const result = await svc.getDoctorByID(req.params.id);
    return res.status(result.status === "SUCCESS" ? 200 : 404).json(result);
});

/**
 * GET /doctors/hospital/:hospitalID
 * Get all doctors in a hospital.
 */
router.get("/hospital/:hospitalID", authenticate, async (req, res) => {
    const result = await svc.getDoctorsByHospital(req.params.hospitalID);
    return res.status(result.status === "SUCCESS" ? 200 : 500).json(result);
});

export default router;