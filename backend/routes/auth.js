import express from "express";
import * as authService from "../services/authService.js";

const router = express.Router();

// ── Doctor Auth ───────────────────────────────────────────────────────────────
// Doctor registration lives at POST /doctors/register (routes/doctor.js),
// which auto-generates doctorID via idService. This file previously also
// exposed POST /auth/doctor/register, which required the caller to supply
// doctorID directly and was unauthenticated — unused anywhere in the app,
// tests, or docs, and a needless attack surface. Removed.

/**
 * POST /auth/doctor/login
 * Password-based login
 * Body: { phone, password }
 */
router.post("/doctor/login", async (req, res) => {
    const { phone, password } = req.body;

    if (!phone || !password) {
        return res.status(400).json({ status: "FAILED", message: "phone and password are required." });
    }

    const result = await authService.loginDoctorPassword(phone, password);
    return res.status(result.status === "SUCCESS" ? 200 : 401).json(result);
});

/**
 * POST /auth/doctor/otp/initiate
 * Body: { phone }
 */
router.post("/doctor/otp/initiate", async (req, res) => {
    const { phone } = req.body;

    if (!phone) {
        return res.status(400).json({ status: "FAILED", message: "phone is required." });
    }

    const result = await authService.initiateDoctorOTP(phone);
    return res.status(result.status === "OTP_SENT" ? 200 : 400).json(result);
});

/**
 * POST /auth/doctor/otp/verify
 * Body: { phone, otp }
 */
router.post("/doctor/otp/verify", async (req, res) => {
    const { phone, otp } = req.body;

    if (!phone || !otp) {
        return res.status(400).json({ status: "FAILED", message: "phone and otp are required." });
    }

    const result = await authService.verifyDoctorOTP(phone, otp);
    return res.status(result.status === "SUCCESS" ? 200 : 401).json(result);
});

// ── Patient Auth ──────────────────────────────────────────────────────────────

/**
 * POST /auth/patient/otp/initiate
 * Body: { phone }
 */
router.post("/patient/otp/initiate", async (req, res) => {
    const { phone } = req.body;

    if (!phone) {
        return res.status(400).json({ status: "FAILED", message: "phone is required." });
    }

    const result = await authService.initiatePatientOTP(phone);
    return res.status(result.status === "OTP_SENT" ? 200 : 400).json(result);
});

/**
 * POST /auth/patient/otp/verify
 * Body: { phone, otp }
 */
router.post("/patient/otp/verify", async (req, res) => {
    const { phone, otp } = req.body;

    if (!phone || !otp) {
        return res.status(400).json({ status: "FAILED", message: "phone and otp are required." });
    }

    const result = await authService.verifyPatientOTP(phone, otp);
    return res.status(result.status === "SUCCESS" ? 200 : 401).json(result);
});

export default router;
