import fs from "fs";
import path from "path";
import os from "os";
import { execFile } from "child_process";
import { promisify } from "util";

import { AuditLogMirror, AnomalyFlag, OrgActor, Doctor, PatientAuth, EmergencyAccessLog } from "./db.js";
import { logAudit } from "./auditMiddleware.js";
import { notify, NotificationEvents, sendEmail } from "./notificationService.js";
import { generateID } from "./idService.js";

const execFileAsync = promisify(execFile);

// ── Config ──────────────────────────────────────────────────────────────────

// Directory containing feature_engineering.py / p1_detector.py (and, only when
// ANOMALY_ENABLE_P2=true, lstm_sequence_model.py / priority_tagging.py). This is a subprocess call to the existing CLI
// scripts, not a REST call to a "small Python model service" — that service is
// still future work per AI_MODEL_ROADMAP.md. This is the pragmatic wiring for
// now; swap execFileAsync calls below for an HTTP call if/when that service
// exists, without changing anything else in this file's flow.
const PYTHON_DIR = process.env.ANOMALY_PYTHON_DIR
    ?? path.resolve(process.cwd(), "../anomalyDetection");
const PYTHON_BIN = process.env.PYTHON_BIN ?? "python3";

// Rolling window scanned every run, not an incremental cursor — simpler and
// robust to worker restarts (no "last run" state to lose), at the cost of
// re-scoring overlapping days each run. Flag de-duplication (below) handles
// the resulting repeat detections cleanly.
const SCAN_WINDOW_HOURS = Number(process.env.ANOMALY_SCAN_WINDOW_HOURS ?? 24);

// Extra history pulled ONLY for LSTM's autoregressive context, not for
// flagging -- lstm_sequence_model.py scores this whole lookback (so events
// in the new SCAN_WINDOW_HOURS window get real prior context instead of an
// empty <START>) but --report-since means only the new window's actor-days
// actually get reported/flagged. Mitigates (doesn't eliminate) the
// "every run resets context" issue -- an actor silent longer than this
// lookback still hits a cold start. See lstm_sequence_model.py's
// score_new() docstring.
const LSTM_CONTEXT_LOOKBACK_DAYS = Number(process.env.ANOMALY_LSTM_LOOKBACK_DAYS ?? 14);

// ── Tiers ────────────────────────────────────────────────────────────────────
// P1 (ensemble, p1_detector.py) is the DEPLOYED DETECTOR: it is the only tier that
// raises alerts (flag + clarification request + actor notification). Its threshold
// is a percentile of a later, unlabelled calibration window, written by
// retrain_pipeline.sh into models/p1_ensemble.joblib and thresholds.json; nothing is
// recomputed from this worker's small rolling window.
//
// P2 (LSTM sequence tier) is EXPERIMENTAL and OFF by default. In the evaluation it adds
// < 0.02 recall over P1 at the cost of extra reviewer load (anomalyDetection/EXPERIMENTS.md).
// With ANOMALY_ENABLE_P2=true it still runs, but its flags are ADVISORY: stored for
// Governance to look at, never notify the actor, never request a clarification, and
// never count toward the clarification quota. Bans stay gated on CONFIRMED review.
const MODEL_DIR = process.env.ANOMALY_MODEL_DIR
    ?? path.join(PYTHON_DIR, "models");
export const P1_PRIORITY = "P1_high_confidence";
export const P2_PRIORITY = "P2_sequence_candidate";
// Read at call time (not import time) so the setting is testable and cannot go stale.
export function isP2Enabled() {
    return String(process.env.ANOMALY_ENABLE_P2 ?? "false").toLowerCase() === "true";
}

// Confirmed (Governance-reviewed, not raw ML) flags within this rolling
// window before an OrgActor gets temporarily banned. Deliberately gated on
// CONFIRMED, never on raw PENDING flags — an unreviewed ML score is not
// grounds for an automatic ban; see reviewFlag()'s docstring.
const BAN_THRESHOLD_CONFIRMED_FLAGS = Number(process.env.ANOMALY_BAN_THRESHOLD ?? 3);
const BAN_DURATION_DAYS = Number(process.env.ANOMALY_BAN_DURATION_DAYS ?? 7);
const COMPLIANCE_REPORT_EMAIL = process.env.COMPLIANCE_REPORT_EMAIL ?? "compliance@medvault.local";

// Violations 1-2 (this actor's 1st/2nd P1 AnomalyFlag ever, any status) get a
// clarification request instead of just a warning. Counted against ALL
// flags (not just CONFIRMED) because this happens at creation time, before
// any human review -- it's "give them a chance to explain" not "punish
// them", so it's deliberately not gated on CONFIRMED the way the ban logic
// in reviewFlag() is.
const CLARIFICATION_FLAG_COUNT = Number(process.env.ANOMALY_CLARIFICATION_FLAG_COUNT ?? 2);

// ── CSV I/O (no new dependency -- fixed, known columns) ─────────────────────

function toCSV(rows, columns) {
    const escape = (v) => {
        const s = v === null || v === undefined ? "" : String(v);
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const header = columns.join(",");
    const body = rows.map((r) => columns.map((c) => escape(r[c])).join(","));
    return [header, ...body].join("\n");
}

function parseCSVLine(line) {
    // Proper quoted-field state machine -- the previous regex splitter
    // (`(".*?"|[^,]+)`) breaks on quoted fields containing an internal
    // comma that directly follows a closing quote (e.g. JSON like
    // `"...x"", "y"...`), which is exactly top_features's shape. That
    // regex would stop at the JSON's own comma, not the real field
    // boundary, silently shifting every later column left by one.
    const fields = [];
    let cur = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (inQuotes) {
            if (c === '"') {
                if (line[i + 1] === '"') { cur += '"'; i++; } // escaped quote
                else inQuotes = false;
            } else {
                cur += c;
            }
        } else if (c === '"') {
            inQuotes = true;
        } else if (c === ",") {
            fields.push(cur);
            cur = "";
        } else {
            cur += c;
        }
    }
    fields.push(cur);
    return fields;
}

function parseCSV(text) {
    const lines = text.trim().split("\n");
    if (lines.length === 0) return [];
    const header = parseCSVLine(lines[0]);
    return lines.slice(1).map((line) => {
        const values = parseCSVLine(line);
        const row = {};
        header.forEach((h, i) => { row[h] = values[i] ?? ""; });
        return row;
    });
}

// ── Actor contact resolution ─────────────────────────────────────────────────

/**
 * Resolve a flagged actorID/actorRole to notifiable contact info. Not
 * guaranteed to find one (actorID could be "system", or a real actor whose
 * profile lookup fails) -- callers must handle a null return.
 */
async function resolveActorContact(actorID, actorRole) {
    if (actorRole === "org_actor") {
        const actor = await OrgActor.findOne({ actorID });
        return actor ? { phone: actor.phone, email: actor.email, name: actor.fullName } : null;
    }
    if (actorRole === "doctor") {
        const doc = await Doctor.findOne({ doctorID: actorID });
        return doc ? { phone: doc.phone, email: doc.email, name: doc.fullName } : null;
    }
    if (actorRole === "patient") {
        const patient = await PatientAuth.findOne({ patientID: actorID });
        return patient ? { phone: patient.phone, email: null, name: null } : null;
    }
    return null;
}

// ── Classification ─────────────────────────────────────────────────

/**
 * Adversary 4 (Emergency Abuse) cross-check. "point" is the default for
 * every flag; this only upgrades it to "emergency_abuse" when the flagged
 * actor had an emergency-access episode overlapping the flagged actor-day.
 * A flag only exists here because the P1 ensemble score already crossed
 * its calibrated threshold -- this doesn't add new detection sensitivity, it labels
 * *why* an already-anomalous day matters more: an anomalous access pattern
 * that happened to fall inside a self-declared "emergency" is exactly the
 * pattern-vs-declared-reason mismatch the spec's Adversary 4 describes, and
 * deserves priority Governance attention over a plain "point" anomaly.
 *
 * Pure Mongo read against EmergencyAccessLog (the existing app-layer mirror
 * -- see db.js) -- no chaincode changes, no new Fabric calls.
 */
async function classifyFlag(actorID, date) {
    const dayStart = new Date(`${date}T00:00:00.000Z`);
    const dayEnd   = new Date(`${date}T23:59:59.999Z`);

    const overlapping = await EmergencyAccessLog.findOne({
        doctorID:  actorID,
        createdAt: { $lte: dayEnd.toISOString() },
        $or: [
            { closedAt: null },
            { closedAt: { $gte: dayStart.toISOString() } },
            { expiresAt: { $gte: dayStart.toISOString() } },
        ],
    }).lean();

    return overlapping ? "emergency_abuse" : "point";
}

// ── Detection cycle ────────────────────────────────────────────────────────────

/**
 * Pulls the last SCAN_WINDOW_HOURS of AuditLogMirror data, runs it through
 * feature_engineering.py + p1_detector.py, and creates a PENDING AnomalyFlag
 * (+ on-chain ANOMALY_FLAGGED audit entry + warning notification) for every
 * P1 actor-day that doesn't already have one. With ANOMALY_ENABLE_P2=true the
 * experimental LSTM tier also runs and adds ADVISORY P2 flags (no actor
 * notification, no clarification request).
 *
 * Also logs the detection run itself as an audited "ai_engine" access --
 * this is the AI reading patient-derived data to make a prediction, and
 * that access deserves the same trail as any other actor's, same as any
 * other AI model (disease predictors, etc.) that reads this data should.
 */
export async function runDetectionCycle(modelVersion = "p1_ensemble_v3") {
    const ENABLE_P2 = isP2Enabled();
    const runID = generateID("anomalyFlag") + "-run";
    const since = new Date(Date.now() - SCAN_WINDOW_HOURS * 3600 * 1000).toISOString();

    // The AI's own read access, audited like any other actor's.
    await logAudit({
        actorID:      modelVersion,
        actorRole:    "ai_engine",
        action:       "READ",
        resourceType: "AUDIT_LOG",
        resourceID:   runID,
    });

    const events = await AuditLogMirror.find({ timestamp: { $gte: since } }).lean();
    if (events.length === 0) {
        console.log(`[Anomaly] No AuditLogMirror events in the last ${SCAN_WINDOW_HOURS}h -- nothing to score.`);
        return { flagsCreated: 0 };
    }

    // Extra lookback for LSTM CONTEXT ONLY (experimental P2 tier) -- the P1
    // ensemble's feature_engineering.py input stays on the narrow `since` window
    // (aggregate daily features don't need history). Fetched only when P2 is on.
    // --report-since (below) tells lstm_sequence_model.py to score this whole range
    // (correct autoregressive context) but only return actor-days on or after `since`.
    const contextSince = new Date(Date.now() - LSTM_CONTEXT_LOOKBACK_DAYS * 24 * 3600 * 1000).toISOString();
    const contextEvents = ENABLE_P2
        ? await AuditLogMirror.find({ timestamp: { $gte: contextSince } }).lean()
        : [];

    const requiredArtifacts = ["p1_ensemble.joblib", "thresholds.json"];
    if (ENABLE_P2) requiredArtifacts.push("lstm_model.pt");
    const missing = requiredArtifacts.filter((f) => !fs.existsSync(path.join(MODEL_DIR, f)));
    if (missing.length > 0) {
        console.error(`[Anomaly] Missing model artifacts in ${MODEL_DIR}: ${missing.join(", ")}. `
            + `Run retrain_pipeline.sh first.`);
        return { flagsCreated: 0 };
    }

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "anomaly-"));
    const rawPath        = path.join(tmpDir, "raw.csv");
    const rawContextPath = path.join(tmpDir, "raw_context.csv");
    const featuresPath   = path.join(tmpDir, "features.csv");
    const scoredPath     = path.join(tmpDir, "scored.csv");
    const lstmPath       = path.join(tmpDir, "lstm_scored.csv");
    const priorityPath   = path.join(tmpDir, "prioritized.csv");

    try {
        const columns = ["auditID", "actorID", "actorRole", "actorOrg", "action", "resourceType", "resourceID", "timestamp"];
        fs.writeFileSync(rawPath, toCSV(events, columns));
        if (ENABLE_P2) fs.writeFileSync(rawContextPath, toCSV(contextEvents, columns));

        await execFileAsync(PYTHON_BIN, [
            path.join(PYTHON_DIR, "feature_engineering.py"),
            "--in", rawPath,
            "--out", featuresPath,
            "--patient-out", path.join(tmpDir, "patient_features.csv"), // no patientID on real data -- script skips this gracefully
        ]);

        await execFileAsync(PYTHON_BIN, [
            path.join(PYTHON_DIR, "p1_detector.py"),
            "score",
            "--in", featuresPath,
            "--out", scoredPath,
            "--model-in", path.join(MODEL_DIR, "p1_ensemble.joblib"),
        ]);

        let resultPath = scoredPath; // P1-only: p1_detector.py already writes `priority`

        if (ENABLE_P2) {
            // EXPERIMENTAL sequence tier. LSTM runs against the RAW event log (needs actual
            // timestamps/order), not the aggregated featuresPath.
            await execFileAsync(PYTHON_BIN, [
                path.join(PYTHON_DIR, "lstm_sequence_model.py"),
                "--in", rawContextPath,
                "--out", lstmPath,
                "--mode", "score",
                "--model-in", path.join(MODEL_DIR, "lstm_model.pt"),
                "--report-since", since,
            ]);

            // thresholds.json carries ensemble_threshold == the P1 threshold, so P1 membership
            // here is identical to the P1-only path; priority_tagging only adds the P2 tier.
            await execFileAsync(PYTHON_BIN, [
                path.join(PYTHON_DIR, "priority_tagging.py"),
                "--ensemble-in", scoredPath,
                "--lstm-in", lstmPath,
                "--out", priorityPath,
                "--thresholds-in", path.join(MODEL_DIR, "thresholds.json"),
            ]);
            resultPath = priorityPath;
        }

        const scoredRows = parseCSV(fs.readFileSync(resultPath, "utf8"));
        let flagsCreated = 0;

        for (const row of scoredRows) {
            if (row.priority !== P1_PRIORITY && row.priority !== P2_PRIORITY) continue;
            if (row.priority === P2_PRIORITY && !ENABLE_P2) continue;
            const isP1 = row.priority === P1_PRIORITY;

            const ensembleScore = Number(row.ensemble_score ?? row.anomaly_score);
            const lstmScore = row.lstm_score !== undefined && row.lstm_score !== ""
                ? Number(row.lstm_score) : null;
            // P1 is driven by the ensemble score, P2 by LSTM's -- this is
            // NOT a weighted blend, each tier fires on its own threshold.
            // combinedScore records whichever score actually drove this flag.
            const combinedScore = isP1 ? ensembleScore : lstmScore;

            const existing = await AnomalyFlag.findOne({
                actorID: row.actorID,
                date:    row.date,
                status:  "PENDING",
            });
            if (existing) continue; // already flagged this actor-day, don't duplicate across overlapping windows

            const flagID    = generateID("anomalyFlag");
            const createdAt = new Date().toISOString();

            let topFeatures = [];
            try { topFeatures = JSON.parse(row.top_features); } catch { /* leave empty if unparsable */ }

            const actorRow = events.find((e) => e.actorID === row.actorID);
            const actorRole = actorRow?.actorRole ?? "";
            const actorOrg  = actorRow?.actorOrg ?? "";

            const auditID = await logAudit({
                actorID:      modelVersion,
                actorRole:    "ai_engine",
                action:       "ANOMALY_FLAGGED",
                resourceType: "ANOMALY_FLAG",
                resourceID:   flagID,
                actorOrg,
            });

            const isEmergencyOverlap = await classifyFlag(row.actorID, row.date);
            const classification = isEmergencyOverlap === "emergency_abuse"
                ? "emergency_abuse"
                : (isP1 ? "point" : "sequential");

            // Violations 1-2: this actor's Nth P1 flag overall (any status),
            // counted BEFORE this one is saved. See CLARIFICATION_FLAG_COUNT
            // doc comment for why this isn't gated on CONFIRMED. Advisory (P2)
            // flags neither request a clarification nor count toward the quota.
            const priorFlagCount = isP1
                ? await AnomalyFlag.countDocuments({ actorID: row.actorID, priority: P1_PRIORITY })
                : 0;
            const clarificationRequested = isP1 && priorFlagCount < CLARIFICATION_FLAG_COUNT;

            await new AnomalyFlag({
                flagID,
                actorID: row.actorID,
                actorRole,
                actorOrg,
                date: row.date,
                ifScore: ensembleScore,
                lstmScore,
                combinedScore,
                priority: row.priority,
                topFeatures,
                classification,
                status: "PENDING",
                auditID: auditID ?? "",
                clarificationRequested,
                createdAt,
            }).save();

            flagsCreated++;

            // Advisory P2 flags are for Governance only: the actor is not contacted.
            const contact = isP1 ? await resolveActorContact(row.actorID, actorRole) : null;
            if (contact) {
                const reason = topFeatures.map((f) => f.feature).join(", ") || "unusual access pattern";
                const message = clarificationRequested
                    ? NotificationEvents.ANOMALY_CLARIFICATION_REQUEST(reason, flagID)
                    : NotificationEvents.ANOMALY_WARNING(reason);
                await notify({
                    recipientID:   row.actorID,
                    recipientRole: actorRole,
                    phone:         contact.phone,
                    email:         contact.email,
                    event:         clarificationRequested ? "ANOMALY_CLARIFICATION_REQUEST" : "ANOMALY_WARNING",
                    message,
                    channel:       contact.email ? "both" : "sms",
                });
            }
        }

        console.log(`[Anomaly] Run ${runID}: scored ${scoredRows.length} actor-day windows, created ${flagsCreated} new flags.`);
        return { flagsCreated };
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
}

// ── Review + escalation ──────────────────────────────────────────────────────

/**
 * Governance reviews a flag. Escalation (ban + authority report) is
 * DELIBERATELY gated on status === "CONFIRMED" -- a human decision -- never
 * on the raw PENDING flag from runDetectionCycle(). An unreviewed ML score
 * is a lead, not evidence; automatically banning on it would let a false
 * positive lock out a real pharmacist/lab-tech with no human in the loop.
 *
 * A DISMISSED review isn't escalated, but IS a weak negative label for
 * future recalibration (see AI_MODEL_ROADMAP.md's feedback-loop
 * recommendation) -- not acted on by this function yet, just preserved on
 * the AnomalyFlag document for whenever that recalibration step is built.
 */
export async function reviewFlag(flagID, status, reviewerActorID, notes = "") {
    if (!["CONFIRMED", "DISMISSED"].includes(status)) {
        return { status: "FAILED", message: "status must be CONFIRMED or DISMISSED." };
    }

    const flag = await AnomalyFlag.findOne({ flagID });
    if (!flag) {
        return { status: "FAILED", message: "Flag not found." };
    }

    flag.status = status;
    flag.reviewedBy = reviewerActorID;
    flag.reviewedAt = new Date().toISOString();
    flag.reviewNotes = notes;
    await flag.save();

    await logAudit({
        actorID:      reviewerActorID,
        actorRole:    "org_actor",
        action:       "UPDATE",
        resourceType: "ANOMALY_FLAG",
        resourceID:   flagID,
        actorOrg:     "GovernanceMSP",
    });

    if (status !== "CONFIRMED" || flag.actorRole !== "org_actor") {
        // Enforcement (ban) is only wired up for org_actor accounts today --
        // Doctor/PatientAuth have no ban fields yet. A confirmed flag against
        // a doctor or patient still exists on record for manual follow-up,
        // just doesn't auto-escalate.
        return { status: "SUCCESS", flag };
    }

    const actor = await OrgActor.findOne({ actorID: flag.actorID });
    if (!actor) return { status: "SUCCESS", flag };

    actor.violationCount += 1;

    if (actor.violationCount >= BAN_THRESHOLD_CONFIRMED_FLAGS) {
        const bannedUntil = new Date(Date.now() + BAN_DURATION_DAYS * 24 * 3600 * 1000).toISOString();
        actor.isBanned = true;
        actor.bannedUntil = bannedUntil;
        await actor.save();

        await notify({
            recipientID:   actor.actorID,
            recipientRole: "org_actor",
            phone:         actor.phone,
            email:         actor.email,
            event:         "ACCOUNT_SUSPENDED",
            message:       NotificationEvents.ACCOUNT_SUSPENDED(bannedUntil),
            channel:       "both",
        });

        await sendAuthorityReport(actor);
    } else {
        await actor.save();
    }

    return { status: "SUCCESS", flag, violationCount: actor.violationCount, banned: actor.isBanned };
}

/**
 * Compiles this actor's confirmed flag history (score, SHAP explanations,
 * linked on-chain auditIDs) and emails it to the configured compliance
 * address. Pure backend -- no new chaincode, reuses sendEmail() as-is.
 */
async function sendAuthorityReport(actor) {
    const confirmedFlags = await AnomalyFlag.find({
        actorID: actor.actorID,
        status: "CONFIRMED",
    }).sort({ createdAt: 1 });

    const lines = confirmedFlags.map((f) => {
        const features = f.topFeatures.map((t) => `${t.feature} (${t.contribution})`).join(", ");
        const tierLabel = f.priority === P2_PRIORITY ? "P2 (experimental, advisory)" : "P1 (alert)";
        const lstmPart = f.lstmScore != null ? `, lstm ${f.lstmScore.toFixed(3)}` : "";
        return `  - ${f.date} | ${tierLabel} | ensemble ${f.ifScore.toFixed(3)}${lstmPart} | `
            + `${features} | on-chain auditID: ${f.auditID}`;
    });

    const text = [
        `Compliance report: repeated confirmed access violations`,
        ``,
        `Actor: ${actor.actorID} (${actor.fullName}, ${actor.org})`,
        `Confirmed flags: ${confirmedFlags.length}`,
        `Account suspended until: ${actor.bannedUntil}`,
        ``,
        `Flag history:`,
        ...lines,
        ``,
        `Each auditID above can be independently verified on the ledger via`,
        `GET /audit-history/:auditID -- this report is generated from that`,
        `same on-chain trail, not a separate unverifiable claim.`,
    ].join("\n");

    await sendEmail(COMPLIANCE_REPORT_EMAIL, `MedVault — Compliance Report: ${actor.actorID}`, text);
}
