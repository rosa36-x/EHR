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
    recipientRole: { type: String, enum: ["doctor", "patient"], required: true },
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

// ── Models ────────────────────────────────────────────────────────────────────
export const Doctor             = mongoose.model("Doctor",             doctorSchema);
export const OrgActor           = mongoose.model("OrgActor",           orgActorSchema);
export const PatientAuth        = mongoose.model("PatientAuth",        patientAuthSchema);
export const OTP                = mongoose.model("OTP",                otpSchema);
export const Notification       = mongoose.model("Notification",       notificationSchema);
export const EmergencyAccessLog = mongoose.model("EmergencyAccessLog", emergencyAccessLogSchema);
