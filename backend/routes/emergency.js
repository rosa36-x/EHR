import express from "express";
import * as svc from "../services/emergencyFabricService.js";
import rateLimit from "express-rate-limit";
import { authenticate, authorizeRoles } from "../services/authMiddleware.js";

const router = express.Router();

const REASON_MIN_LENGTH = 10;
const REASON_MAX_LENGTH = 1000;

// Break-glass grants 24h of access per call, so cap how many a single doctor
// can open per hour. Counted per doctor, not per IP. Tunable via env.
const emergencyLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: Number(process.env.EMERGENCY_RATE_LIMIT_MAX) || 10,
    keyGenerator: (req) => req.user.id,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => res.status(429).json({
        status: "FAILED",
        message: "Too many emergency access requests. Try again later.",
    }),
});

/**
 * POST /emergency-access
 * Body: { patientID, reason }
 * The caller's identity comes from the JWT; any doctorID, status or
 * emergencyAccessID in the body is ignored.
 */
router.post("/", authenticate, authorizeRoles("doctor"), emergencyLimiter, async (req, res) => {
    const { patientID, reason } = req.body ?? {};

    // typeof checks also stop objects like { "$ne": null } reaching Mongo queries.
    if (typeof patientID !== "string" || !patientID.trim() || typeof reason !== "string") {
        return res.status(400).json({
            status: "FAILED",
            message: "patientID and reason are required and must be strings.",
        });
    }

    const trimmedReason = reason.trim();
    if (trimmedReason.length < REASON_MIN_LENGTH || trimmedReason.length > REASON_MAX_LENGTH) {
        return res.status(400).json({
            status: "FAILED",
            message: `reason must be between ${REASON_MIN_LENGTH} and ${REASON_MAX_LENGTH} characters.`,
        });
    }

    const result = await svc.createEmergencyAccess(
        { patientID: patientID.trim(), doctorID: req.user.id, reason: trimmedReason },
        req.user.id
    );
    const statusCode =
        result.status === "SUCCESS" ? 200
        : result.status === "NOT_FOUND" ? 404
        : result.message?.includes("already have active") ? 409
        : 500;
    return res.status(statusCode).json(result);
});

/**
 * GET /emergency-access
 * The calling doctor's own active, unexpired emergency accesses.
 */
router.get("/", authenticate, authorizeRoles("doctor"), async (req, res) => {
    const result = await svc.listActiveEmergencyAccess(req.user.id);
    return res.status(result.status === "SUCCESS" ? 200 : 500).json(result);
});

/**
 * GET /emergency-access/:id
 */
router.get("/:id", authenticate, async (req, res) => {
    const result = await svc.getEmergencyAccess(req.params.id, req.user.id, req.user.role);
    const statusCode = result.status === "SUCCESS" ? 200
        : result.status === "ACCESS_DENIED" ? 403
        : result.status === "NOT_FOUND" ? 404
        : 500;
    return res.status(statusCode).json(result);
});

/**
 * PATCH /emergency-access/:id/close
 * Explicitly ends an emergency access episode — revokes the doctor's access
 * immediately rather than waiting on the 24-hour safety-net expiry.
 */
router.patch("/:id/close", authenticate, authorizeRoles("doctor"), async (req, res) => {
    const result = await svc.closeEmergencyAccess(req.params.id, req.user.id, req.user.role);
    const statusCode = result.status === "SUCCESS" ? 200
        : result.status === "ACCESS_DENIED" ? 403
        : result.status === "NOT_FOUND" ? 404
        : 500;
    return res.status(statusCode).json(result);
});

export default router;
