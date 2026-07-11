/**
 * anomalyWorker.js
 *
 * Standalone entrypoint for the anomaly detection loop — deliberately a
 * separate process from server.js/Express, not a setInterval() bolted onto
 * the API server. This is what makes the "AI as a governed, independent
 * actor" framing in AI_MODEL_ROADMAP.md literally true at the process
 * level, not just at the audit-log-identity level (see that file's framing
 * note for the distinction).
 *
 * Usage:
 *   node anomalyWorker.js            # run on a schedule (default: hourly)
 *   node anomalyWorker.js --once     # run a single detection cycle and exit
 *
 * Env vars (all optional, see anomalyDetectionService.js for full list):
 *   ANOMALY_INTERVAL_MINUTES   how often to run (default 60)
 *   ANOMALY_PYTHON_DIR         path to the anomalyDetection/ scripts
 *   ANOMALY_SCAN_WINDOW_HOURS  how far back each run looks (default 24)
 *   ANOMALY_FLAG_THRESHOLD     anomaly_score cutoff to create a flag
 *
 * No node-cron dependency -- a plain setInterval is enough here and keeps
 * this file installable with zero new packages.
 */

import { connectDB } from "./services/db.js";
import { runDetectionCycle } from "./services/anomalyDetectionService.js";

const INTERVAL_MINUTES = Number(process.env.ANOMALY_INTERVAL_MINUTES ?? 60);
const MODEL_VERSION = process.env.ANOMALY_MODEL_VERSION ?? "isolation_forest_v1";

async function runOnce() {
    try {
        const result = await runDetectionCycle(MODEL_VERSION);
        console.log(`[anomalyWorker] cycle complete:`, result);
    } catch (err) {
        console.error("[anomalyWorker] detection cycle failed:", err);
    }
}

async function main() {
    await connectDB();

    const runOnceOnly = process.argv.includes("--once");

    if (runOnceOnly) {
        await runOnce();
        process.exit(0);
    }

    console.log(`[anomalyWorker] started — running every ${INTERVAL_MINUTES} minutes.`);
    await runOnce(); // run immediately on startup, then on the interval
    setInterval(runOnce, INTERVAL_MINUTES * 60 * 1000);
}

main().catch((err) => {
    console.error("[anomalyWorker] fatal startup error:", err);
    process.exit(1);
});
