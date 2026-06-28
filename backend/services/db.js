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
 * Patient auth — lightweight auth record.
 * Full patient data lives on Fabric (PatientRecordCollection).
 * Only auth credentials stored here.
 */
const patientAuthSchema = new mongoose.Schema({
    patientID:  { type: String, required: true, unique: true },
    phone:      { type: String, required: true, unique: true },
    createdAt:  { type: String },
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

// ── Models ────────────────────────────────────────────────────────────────────
export const Doctor       = mongoose.model("Doctor",      doctorSchema);
export const PatientAuth  = mongoose.model("PatientAuth", patientAuthSchema);
export const OTP          = mongoose.model("OTP",         otpSchema);
export const Notification = mongoose.model("Notification", notificationSchema);
