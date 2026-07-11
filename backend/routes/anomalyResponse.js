import express from "express";
import { AnomalyFlag } from "../services/db.js";
import { authenticate } from "../services/authMiddleware.js";

// Deliberately a SEPARATE router from routes/anomaly.js, which applies
// requireOrgActorOrg("GovernanceMSP") to everything under it. This route
// is for the flagged actor themselves (org_actor/doctor/patient — whichever
// role the flag belongs to), not Governance, so it only needs `authenticate`
// plus an explicit ownership check below. Must be mounted at "/anomalies"
// BEFORE routes/anomaly.js in server.js so this path is matched first.
const router = express.Router();

/**
 * POST /anomalies/:id/respond
 * Body: { text }
 *
 * Lets the actor named on an AnomalyFlag submit a clarification BEFORE
 * Governance reviews it — e.g. "that was a legitimate off-hour access,
 * I was covering an on-call shift." Only allowed when:
 *   - the flag belongs to the authenticated caller (ownership check)
 *   - clarificationRequested is true (violations 1-2 only — see
 *     anomalyDetectionService.js's CLARIFICATION_FLAG_COUNT)
 *   - the flag hasn't already been reviewed (still PENDING)
 *
 * This does NOT change the flag's status or bypass review — it just
 * attaches context for the human reviewer, same spirit as reviewNotes but
 * authored by the flagged actor instead of Governance.
 */
router.post("/:id/respond", authenticate, async (req, res) => {
    try {
        const { text } = req.body;
        if (!text || typeof text !== "string" || !text.trim()) {
            return res.status(400).json({ status: "FAILED", message: "text is required." });
        }

        const flag = await AnomalyFlag.findOne({ flagID: req.params.id });
        if (!flag) {
            return res.status(404).json({ status: "FAILED", message: "Flag not found." });
        }

        if (flag.actorID !== req.user.id) {
            return res.status(403).json({ status: "FAILED", message: "This flag does not belong to you." });
        }

        if (!flag.clarificationRequested) {
            return res.status(400).json({
                status: "FAILED",
                message: "No clarification was requested for this flag.",
            });
        }

        if (flag.status !== "PENDING") {
            return res.status(400).json({
                status: "FAILED",
                message: `This flag has already been ${flag.status.toLowerCase()} by Governance.`,
            });
        }

        flag.clarificationText = text.trim();
        flag.clarificationSubmittedAt = new Date().toISOString();
        await flag.save();

        return res.json({ status: "SUCCESS", data: flag });
    } catch (err) {
        return res.status(500).json({ status: "FAILED", message: err.message });
    }
});

export default router;
