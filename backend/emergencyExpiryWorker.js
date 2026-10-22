/**
 * emergencyExpiryWorker.js
 *
 * Standalone process that closes emergency accesses whose 24h window has
 * lapsed, so the ledger record, EmergencyAccessLog and backing treatment
 * relationship all reflect the expiry and the patient is notified.
 *
 * Usage:
 *   node emergencyExpiryWorker.js            # run on a schedule (default: every 5 min)
 *   node emergencyExpiryWorker.js --once     # run a single sweep and exit
 *
 * Env vars:
 *   EMERGENCY_EXPIRY_INTERVAL_MINUTES   how often to sweep (default 5)
 */

import { connectDB } from "./services/db.js";
import { expireStaleEmergencyAccess } from "./services/emergencyFabricService.js";

const INTERVAL_MINUTES = Number(process.env.EMERGENCY_EXPIRY_INTERVAL_MINUTES ?? 5);

async function runOnce() {
    try {
        const result = await expireStaleEmergencyAccess();
        console.log("[emergencyExpiryWorker] sweep complete:", result);
    } catch (err) {
        console.error("[emergencyExpiryWorker] sweep failed:", err);
    }
}

async function main() {
    await connectDB();

    if (process.argv.includes("--once")) {
        await runOnce();
        process.exit(0);
    }

    console.log(`[emergencyExpiryWorker] started — sweeping every ${INTERVAL_MINUTES} minutes.`);
    await runOnce();
    setInterval(runOnce, INTERVAL_MINUTES * 60 * 1000);
}

main().catch((err) => {
    console.error("[emergencyExpiryWorker] fatal startup error:", err);
    process.exit(1);
});
