import express from "express";
import * as authService from "../services/authService.js";

const router = express.Router();

// Body values go straight into Mongo filters ({ phone }), so an object such as
// { "$ne": null } would match any account. Require plain strings.
const allStrings = (...vals) => vals.every((v) => typeof v === "string" && v.length > 0);


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

    if (!allStrings(phone, password)) {
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

    if (!allStrings(phone)) {
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

    if (!allStrings(phone, otp)) {
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

    if (!allStrings(phone)) {
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

    if (!allStrings(phone, otp)) {
        return res.status(400).json({ status: "FAILED", message: "phone and otp are required." });
    }

    const result = await authService.verifyPatientOTP(phone, otp);
    return res.status(result.status === "SUCCESS" ? 200 : 401).json(result);
});

// ── Org Actor Auth (pharmacist, lab-tech) ──────────────────────────────────────

/**
 * POST /auth/org-actor/register
 * Body: { fullName, org, phone, email, password }
 * org must be "PharmacyMSP" or "LaboratoryMSP".
 */
router.post("/org-actor/register", async (req, res) => {
    const { fullName, org, phone, email, password } = req.body;

    if (!fullName || !org || !phone || !email || !password) {
        return res.status(400).json({
            status: "FAILED",
            message: "fullName, org, phone, email, password are required.",
        });
    }

    const result = await authService.registerOrgActor(req.body);
    return res.status(result.status === "SUCCESS" ? 200 : 400).json(result);
});

/**
 * POST /auth/org-actor/login
 * Body: { phone, password }
 */
router.post("/org-actor/login", async (req, res) => {
    const { phone, password } = req.body;

    if (!allStrings(phone, password)) {
        return res.status(400).json({ status: "FAILED", message: "phone and password are required." });
    }

    const result = await authService.loginOrgActorPassword(phone, password);
    return res.status(result.status === "SUCCESS" ? 200 : 401).json(result);
});

export default router;
