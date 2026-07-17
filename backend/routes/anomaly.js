import express from "express";
import { AnomalyFlag } from "../services/db.js";
import { authenticate, requireOrgActorOrg } from "../services/authMiddleware.js";
import { runDetectionCycle, reviewFlag } from "../services/anomalyDetectionService.js";

const router = express.Router();

// Every route here is Governance-only — reviewing anomaly flags and
// triggering enforcement is exactly the kind of action the whole
// consent/audit system exists to gate behind a real, audited identity.
router.use(authenticate, requireOrgActorOrg("GovernanceMSP"));

/**
 * GET /anomalies
 * Query params: status (PENDING|CONFIRMED|DISMISSED, optional), limit (default 50)
 */
router.get("/", async (req, res) => {
    try {
        const filter = {};
        if (req.query.status) filter.status = req.query.status;

        const limit = Math.min(Number(req.query.limit) || 50, 200);
        const flags = await AnomalyFlag.find(filter).sort({ createdAt: -1 }).limit(limit);

        return res.json({ status: "SUCCESS", data: flags });
    } catch (err) {
        return res.status(500).json({ status: "FAILED", message: err.message });
    }
});

/**
 * GET /anomalies/summary
 * Aggregate stats for the review dashboard's charts:
 *   - byStatus: counts for a PENDING/CONFIRMED/DISMISSED breakdown (pie/donut)
 *   - byDay: flags created per day, last 30 days (trend line)
 *   - topActors: actors with the most CONFIRMED flags (bar chart)
 *   - scoreDistribution: bucketed ifScore (ensemble anomaly_score) histogram
 *   - byPriority: P1_high_confidence vs P2_sequence_candidate counts -- see
 *     priority_tagging.py; P2 is the lower-confidence, LSTM-driven tier and
 *     should be shown/labeled separately, not folded into one flagged count
 */
router.get("/summary", async (req, res) => {
    try {
        const [byStatus, byDay, topActors, byPriority, allScores] = await Promise.all([
            AnomalyFlag.aggregate([
                { $group: { _id: "$status", count: { $sum: 1 } } },
            ]),
            AnomalyFlag.aggregate([
                { $match: { createdAt: { $gte: new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString() } } },
                { $group: { _id: { $substr: ["$createdAt", 0, 10] }, count: { $sum: 1 } } },
                { $sort: { _id: 1 } },
            ]),
            AnomalyFlag.aggregate([
                { $match: { status: "CONFIRMED" } },
                { $group: { _id: { actorID: "$actorID", actorOrg: "$actorOrg" }, count: { $sum: 1 } } },
                { $sort: { count: -1 } },
                { $limit: 10 },
            ]),
            AnomalyFlag.aggregate([
                { $group: { _id: "$priority", count: { $sum: 1 } } },
            ]),
            AnomalyFlag.find({}, { ifScore: 1 }).lean(),
        ]);

        const buckets = [0, 0, 0, 0, 0]; // [0-.2, .2-.4, .4-.6, .6-.8, .8-1+]
        for (const { ifScore } of allScores) {
            const idx = Math.min(4, Math.max(0, Math.floor(ifScore / 0.2)));
            buckets[idx]++;
        }

        return res.json({
            status: "SUCCESS",
            data: {
                byStatus: Object.fromEntries(byStatus.map((r) => [r._id, r.count])),
                byDay: byDay.map((r) => ({ date: r._id, count: r.count })),
                topActors: topActors.map((r) => ({ actorID: r._id.actorID, actorOrg: r._id.actorOrg, count: r.count })),
                byPriority: Object.fromEntries(byPriority.map((r) => [r._id ?? "unknown", r.count])),
                scoreDistribution: [
                    { range: "0.0–0.2", count: buckets[0] },
                    { range: "0.2–0.4", count: buckets[1] },
                    { range: "0.4–0.6", count: buckets[2] },
                    { range: "0.6–0.8", count: buckets[3] },
                    { range: "0.8–1.0+", count: buckets[4] },
                ],
            },
        });
    } catch (err) {
        return res.status(500).json({ status: "FAILED", message: err.message });
    }
});

/**
 * GET /anomalies/:id
 */
router.get("/:id", async (req, res) => {
    try {
        const flag = await AnomalyFlag.findOne({ flagID: req.params.id });
        if (!flag) return res.status(404).json({ status: "FAILED", message: "Flag not found." });
        return res.json({ status: "SUCCESS", data: flag });
    } catch (err) {
        return res.status(500).json({ status: "FAILED", message: err.message });
    }
});

/**
 * PATCH /anomalies/:id/review
 * Body: { status: "CONFIRMED" | "DISMISSED", notes? }
 * See anomalyDetectionService.reviewFlag() for the escalation logic this
 * can trigger (ban + authority report on repeated CONFIRMED violations).
 */
router.patch("/:id/review", async (req, res) => {
    const { status, notes } = req.body;
    if (!status) {
        return res.status(400).json({ status: "FAILED", message: "status is required." });
    }

    const result = await reviewFlag(req.params.id, status, req.user.id, notes ?? "");
    return res.status(result.status === "SUCCESS" ? 200 : 400).json(result);
});

/**
 * POST /anomalies/run
 * Manually trigger a detection cycle — useful for testing/demo without
 * waiting for anomalyWorker.js's scheduler. Same function the worker calls.
 */
router.post("/run", async (req, res) => {
    try {
        const result = await runDetectionCycle();
        return res.json({ status: "SUCCESS", data: result });
    } catch (err) {
        return res.status(500).json({ status: "FAILED", message: err.message });
    }
});

export default router;
