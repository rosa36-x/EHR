import mongoose from "mongoose";

const MONGO_URI = process.env.MONGO_URI ?? "mongodb://localhost:27017/medvault";

let isConnected = false;

/**
 * Connect to MongoDB.
 * Safe to call multiple times — only connects once.
 */
export async function connectDB() {
    if (isConnected) return;

    try {
        await mongoose.connect(MONGO_URI);
        isConnected = true;
        console.log("[DB] MongoDB connected:", MONGO_URI);
    } catch (err) {
        console.error("[DB] MongoDB connection failed:", err);
        process.exit(1);
    }
}

// ── Schemas ───────────────────────────────────────────────────────────────────

/**
 * Doctor — application-layer identity (not a Fabric identity)
 * All doctors share HospitalMSP Fabric identity.
 * Auth and profile tracked here.
 */
const doctorSchema = new mongoose.Schema({
    doctorID:       { type: String, required: true, unique: true },
    fullName:       { type: String, required: true },
    licenseNumber:  { type: String, required: true, unique: true },
    specialization: { type: String, required: true },
    hospitalID:     { type: String, required: true },
    phone:          { type: String, required: true, unique: true },
    email:          { type: String, required: true, unique: true },
    passwordHash:   { type: String, required: true },
    isVerified:     { type: Boolean, default: false },
    createdAt:      { type: String },
});

/**
 * OrgActor — application-layer identity for a partner-org staff member
 * (pharmacist, lab tech) who authenticates to act as their org, e.g. a
 * pharmacist reading a prescription under patient consent to PharmacyMSP.
 *
 * Deliberately thinner than Doctor: cross-org access is gated by
 * (patient consent -> granteeOrg) on-chain, not by which specific person is
 * logged in, so there's no license/specialization to track here — org is
 * the unit of authorization. See accessControlService.js.
 */
const orgActorSchema = new mongoose.Schema({
    actorID:      { type: String, required: true, unique: true },
    fullName:     { type: String, required: true },
    org:          { type: String, required: true, enum: ["PharmacyMSP", "LaboratoryMSP", "GovernanceMSP"] },
    phone:        { type: String, required: true, unique: true },
    email:        { type: String, required: true, unique: true },
    passwordHash: { type: String, required: true },
    isVerified:   { type: Boolean, default: true },
    // Anomaly-detection enforcement fields. Escalation only ever increments
    // violationCount on a Governance-CONFIRMED flag (routes/anomaly.js), never
    // on a raw unreviewed ML flag — see anomalyDetectionService.js for why.
    violationCount: { type: Number, default: 0 },
    isBanned:       { type: Boolean, default: false },
    bannedUntil:    { type: String, default: null }, // ISO string; null = not banned, checked in authMiddleware.authenticate
    createdAt:    { type: String },
});

/**
 * Patient auth — lightweight auth record.
 * Full patient data lives on Fabric (PatientRecordCollection).
 * Only auth credentials stored here.
 */
const patientAuthSchema = new mongoose.Schema({
    patientID:   { type: String, required: true, unique: true },
    phone:       { type: String, required: true, unique: true },
    // Salted HMAC of the Aadhaar number (see uidaiService.hashAadhaar) — lets
    // us detect the same real person re-registering under a different phone
    // number, without ever storing the raw Aadhaar number. sparse: true
    // because older records (if any existed before this field) won't have it.
    aadhaarHash: { type: String, unique: true, sparse: true },
    createdAt:   { type: String },
});

/**
 * OTP store — temporary OTPs for both doctor and patient login.
 * TTL index auto-deletes expired OTPs after 5 minutes.
 */
const otpSchema = new mongoose.Schema({
    phone:      { type: String, required: true },
    otp:        { type: String, required: true },
    role:       { type: String, enum: ["doctor", "patient"], required: true },
    createdAt:  { type: Date, default: Date.now, expires: 300 }, // 5 min TTL
});

/**
 * Notification — stores all notification events for audit + resend
 */
const notificationSchema = new mongoose.Schema({
    recipientID:   { type: String, required: true }, // patientID or doctorID
    recipientRole: { type: String, enum: ["doctor", "patient", "org_actor"], required: true },
    phone:         { type: String },
    email:         { type: String },
    event:         { type: String, required: true },
    message:       { type: String, required: true },
    channel:       { type: String, enum: ["sms", "email", "both"] },
    status:        { type: String, enum: ["SENT", "FAILED"], default: "SENT" },
    createdAt:     { type: String },
});

/**
 * Emergency Access Log — app-layer tracking for emergency access lifecycle.
 *
 * The Fabric ledger's EmergencyAccess record only supports Create/Get today
 * (no status update), so this collection is the source of truth for whether
 * an emergency access episode is still open, and for which
 * TreatmentRelationship it granted (so it can be revoked on close).
 *
 * See docs/emergency-access-chaincode-todo.md for what would need to move
 * on-chain if/when the chaincode gets an update function for this.
 */
const emergencyAccessLogSchema = new mongoose.Schema({
    emergencyAccessID: { type: String, required: true, unique: true },
    relationshipID:    { type: String, required: true },
    doctorID:          { type: String, required: true },
    patientID:         { type: String, required: true },
    reason:             { type: String },
    status:            { type: String, enum: ["ACTIVE", "CLOSED"], default: "ACTIVE" },
    expiresAt:         { type: String, required: true }, // 24h safety-net ceiling
    createdAt:         { type: String },
    closedAt:          { type: String },
    closedBy:          { type: String },
});

/**
 * AuditLogMirror — a queryable Mongo copy of every on-chain AuditLog entry,
 * written by auditMiddleware.logAudit() right after the chaincode call
 * succeeds. Exists ONLY because chaincode/audit_contract.go has no range/
 * bulk query (GetAuditLog only fetches one entry by auditID) — there is no
 * way to ask the ledger "give me every audit log from the last 24h" without
 * a new chaincode function, which this whole feature was scoped to avoid.
 *
 * The ledger entry remains the sole tamper-evident source of truth; this
 * mirror is a read-model projection for analytics only (anomaly detection's
 * feature pipeline), never used for access-control decisions. If this
 * collection and the ledger ever disagree, the ledger wins — nothing here
 * is authoritative.
 */
const auditLogMirrorSchema = new mongoose.Schema({
    auditID:      { type: String, required: true, unique: true },
    actorID:      { type: String, required: true },
    actorRole:    { type: String, required: true },
    actorOrg:     { type: String, default: "" },
    action:       { type: String, required: true },
    resourceType: { type: String, required: true },
    resourceID:   { type: String, required: true },
    timestamp:    { type: String, required: true },
});
auditLogMirrorSchema.index({ timestamp: 1 });
auditLogMirrorSchema.index({ actorID: 1, timestamp: 1 });

/**
 * AnomalyFlag — output of the anomaly detection pipeline (5-model PyOD
 * ensemble + LSTM, combined via a two-tier priority system -- see
 * priority_tagging.py -- NOT a single blended score; a linear blend was
 * found to suppress LSTM's signal on sequence-type anomalies specifically).
 * The flag itself is also logged on-chain via logAudit() with actorRole
 * "ai_engine" (see anomalyDetectionService.js) -- auditID here links back
 * to that entry as proof the flag was actually raised then, not fabricated
 * later. Anything beyond {score, status} is too rich/variable-shaped for
 * the fixed AuditLog struct, which is why it lives here instead of on-chain.
 */
const anomalyFlagSchema = new mongoose.Schema({
    flagID:        { type: String, required: true, unique: true },
    actorID:       { type: String, required: true },
    actorRole:     { type: String, required: true },
    actorOrg:      { type: String, default: "" },
    date:          { type: String, required: true }, // the actor-day window this flag covers
    ifScore:       { type: Number, required: true }, // 5-model PyOD ensemble's anomaly_score (name kept for schema/migration compat -- it's the ensemble score, not solo Isolation Forest -- see pyod_ensemble.py)
    lstmScore:     { type: Number, default: null },  // LSTM's max_z_surprisal, now populated live (was always null pre-priority-system)
    combinedScore: { type: Number, required: true }, // whichever of the two scores drove this flag's tier (ensemble score for P1, lstm score for P2) -- NOT a weighted blend
    // Which tier fired: P1 = ensemble anomaly_score >= its own p97; P2 =
    // LSTM max_z_surprisal >= its own p99 AND not already P1 (dedup, P1
    // wins). See priority_tagging.py for the full rationale + thresholds.
    priority:      { type: String, enum: ["P1_high_confidence", "P2_sequence_candidate"], required: true },
    topFeatures:   { type: [mongoose.Schema.Types.Mixed], default: [] }, // SHAP output: [{feature, contribution}, ...]
    // Classification taxonomy (see AI_MODEL_ROADMAP.md for the full 4-type
    // spec). "sequential" now detected live (P2 tier, LSTM-driven) --
    // "ai_entity" (rogue/compromised AI-model actor) remains future work,
    // since no AI-model actor identity exists in the system yet.
    classification: { type: String, enum: ["point", "emergency_abuse", "sequential"], default: "point" },
    status:        { type: String, enum: ["PENDING", "CONFIRMED", "DISMISSED"], default: "PENDING" },
    auditID:       { type: String, required: true }, // links to the on-chain ANOMALY_FLAGGED entry
    reviewedBy:    { type: String, default: null },   // Governance actorID
    reviewedAt:    { type: String, default: null },
    reviewNotes:   { type: String, default: "" },
    // Violations 1-2 clarification loop: set at flag-creation time (see
    // anomalyDetectionService.js) when this is the actor's 1st/2nd flag ever.
    // The flagged actor themselves can fill clarificationText in via
    // POST /anomalies/:id/respond (routes/anomalyResponse.js) BEFORE
    // Governance reviews it -- gives "legitimate off-hour access"-style
    // context a chance to surface before a human confirms/dismisses.
    clarificationRequested:    { type: Boolean, default: false },
    clarificationText:        { type: String, default: "" },
    clarificationSubmittedAt: { type: String, default: null },
    createdAt:     { type: String, required: true },
});
anomalyFlagSchema.index({ actorID: 1, status: 1 });
anomalyFlagSchema.index({ createdAt: 1 });

// ── Models ────────────────────────────────────────────────────────────────────
export const Doctor             = mongoose.model("Doctor",             doctorSchema);
export const OrgActor           = mongoose.model("OrgActor",           orgActorSchema);
export const PatientAuth        = mongoose.model("PatientAuth",        patientAuthSchema);
export const OTP                = mongoose.model("OTP",                otpSchema);
export const Notification       = mongoose.model("Notification",       notificationSchema);
export const EmergencyAccessLog = mongoose.model("EmergencyAccessLog", emergencyAccessLogSchema);
export const AuditLogMirror     = mongoose.model("AuditLogMirror",     auditLogMirrorSchema);
export const AnomalyFlag        = mongoose.model("AnomalyFlag",        anomalyFlagSchema);
