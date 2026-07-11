/**
 * seed_synthetic_audit_data.js
 *
 * Loads generate_synthetic_audit_data.py's JSON output, shifts every
 * timestamp forward so the most recent event lands at "now" (preserving
 * relative spacing between events), strips the eval-only patientID/label
 * columns, and inserts the result into AuditLogMirror -- so the live
 * anomalyWorker.js has enough realistic volume in its scan window to
 * produce meaningful anomaly_scores, instead of the 1-5 row windows
 * you've been testing against.
 *
 * Why the shift is necessary: the generator hardcodes its start date to
 * 2026-01-01 and runs forward --days N days. anomalyDetectionService.js's
 * runDetectionCycle() only pulls AuditLogMirror rows from the last
 * SCAN_WINDOW_HOURS (default 24h). Without shifting, every generated row
 * is months old and none of it would ever enter the worker's scan window,
 * regardless of --days.
 *
 * Usage:
 *   1. Generate JSON output (note --json flag, and use a small --days so
 *      the run doesn't produce more data than you want mirrored):
 *
 *        cd anomalyDetection
 *        python generate_synthetic_audit_data.py --out synthetic_audit_log.csv --days 2 --json
 *
 *      This also writes synthetic_audit_log.json alongside the CSV.
 *
 *   2. Run this script from backend/ (it imports your real db.js/AuditLogMirror
 *      model, so inserted rows match your actual schema -- no guessing):
 *
 *        node seed_synthetic_audit_data.js ../anomalyDetection/synthetic_audit_log.json
 *
 *   3. Then run the worker as usual:
 *
 *        node anomalyWorker.js --once
 *
 * This is ADDITIVE -- it does not clear AuditLogMirror first. Re-running
 * this script multiple times will keep adding more rows (each with a
 * fresh auditID via crypto.randomUUID(), so no collisions). If you want a
 * clean slate between experiments, clear the collection yourself first,
 * e.g. in mongosh:
 *
 *   use medvault
 *   db.auditlogmirrors.deleteMany({})
 *
 * (collection name may differ -- check db.js/AuditLogMirror's actual
 * mongoose collection name if "auditlogmirrors" doesn't match.)
 */

import fs from "fs";
import path from "path";
import { connectDB, AuditLogMirror } from "./services/db.js";

// Real AuditLog fields only -- patientID/label are synthetic-only
// eval/ground-truth columns per generate_synthetic_audit_data.py's
// docstring, not part of the real AuditLog schema.
const REAL_COLUMNS = ["auditID", "actorID", "actorRole", "actorOrg", "action", "resourceType", "resourceID", "timestamp"];

async function main() {
    const jsonPath = process.argv[2];
    if (!jsonPath) {
        console.error("Usage: node seed_synthetic_audit_data.js <path-to-synthetic_audit_log.json>");
        process.exit(1);
    }

    const raw = JSON.parse(fs.readFileSync(path.resolve(jsonPath), "utf8"));
    if (!Array.isArray(raw) || raw.length === 0) {
        console.error("No rows found in JSON file.");
        process.exit(1);
    }

    // Shift so the LATEST event in the dataset becomes "now". This
    // preserves relative spacing/bursts/off-hours patterns exactly as
    // the generator built them -- only the absolute date moves.
    const timestamps = raw.map((r) => new Date(r.timestamp).getTime());
    const maxTs = Math.max(...timestamps);
    const shiftMs = Date.now() - maxTs;

    const docs = raw.map((r) => {
        const doc = {};
        for (const col of REAL_COLUMNS) {
            doc[col] = r[col];
        }
        doc.timestamp = new Date(new Date(r.timestamp).getTime() + shiftMs).toISOString();
        return doc;
    });

    await connectDB();
    console.log(`Inserting ${docs.length} synthetic AuditLogMirror rows ` +
                `(shifted so latest event = now, earliest = ${docs.reduce((min, d) => d.timestamp < min ? d.timestamp : min, docs[0].timestamp)})...`);

    const result = await AuditLogMirror.insertMany(docs, { ordered: false });
    console.log(`Inserted ${result.length} rows.`);
    process.exit(0);
}

main().catch((err) => {
    console.error("Seed script failed:", err);
    process.exit(1);
});
