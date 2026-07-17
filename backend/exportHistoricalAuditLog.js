// exportHistoricalAuditLog.js
//
// Exports a large historical window of AuditLogMirror (e.g. 90 days) to CSV,
// for retrain_pipeline.sh to feed into feature_engineering.py + --mode train.
// Deliberately separate from runDetectionCycle()'s own small rolling-window
// pull (SCAN_WINDOW_HOURS) -- training needs months of data, scoring needs
// hours; conflating them was the whole "refit every cycle" problem.
//
// Usage: node exportHistoricalAuditLog.js --days 90 --out raw_history.csv

import fs from "fs";
import { connectDB, AuditLogMirror } from "./services/db.js";
import mongoose from "mongoose";

function toCSV(rows, columns) {
    const escape = (v) => {
        const s = String(v ?? "");
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const header = columns.join(",");
    const body = rows.map((r) => columns.map((c) => escape(r[c])).join(",")).join("\n");
    return header + "\n" + body + "\n";
}

async function main() {
    const args = Object.fromEntries(
        process.argv.slice(2).reduce((acc, arg, i, arr) => {
            if (arg.startsWith("--")) acc.push([arg.slice(2), arr[i + 1]]);
            return acc;
        }, [])
    );
    const days = Number(args.days ?? 90);
    const outPath = args.out ?? "raw_history.csv";

    await connectDB();
    // timestamp is stored as an ISO STRING (schema: { type: String }), not a
    // BSON Date -- must compare against a string in the same format, or the
    // comparison is unreliable. Matches anomalyDetectionService.js's own
    // `since` construction.
    const since = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();
    const events = await AuditLogMirror.find({ timestamp: { $gte: since } }).lean();

    const columns = ["auditID", "actorID", "actorRole", "actorOrg", "action", "resourceType", "resourceID", "timestamp"];
    fs.writeFileSync(outPath, toCSV(events, columns));
    console.log(`Exported ${events.length} events from the last ${days} days to ${outPath}`);

    await mongoose.disconnect();
}

main().catch((err) => {
    console.error("[exportHistoricalAuditLog] failed:", err);
    process.exit(1);
});
