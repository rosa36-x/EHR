import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { Doctor, PatientAuth, OTP } from "./db.js";
import { sendSMS } from "./notificationService.js";

const JWT_SECRET      = process.env.JWT_SECRET ?? "medvault-dev-secret-change-in-prod";
const DOCTOR_JWT_EXP  = "8h";
const PATIENT_JWT_EXP = "24h";

// ── Helpers ───────────────────────────────────────────────────────────────────

function generateOTP() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

function generateToken(payload, expiresIn) {
    return jwt.sign(payload, JWT_SECRET, { expiresIn });
}

export function verifyToken(token) {
    return jwt.verify(token, JWT_SECRET);
}

// ── Doctor Auth ───────────────────────────────────────────────────────────────

/**
 * Register a new doctor.
 * Mock license validation — checks license number format only.
 * Real NMC API integration can replace this later.
 */
export async function registerDoctor(data) {
    try {
        // Mock license validation: NMC format is alphanumeric, 5-15 chars
        if (!/^[A-Z0-9]{5,15}$/.test(data.licenseNumber)) {
            return { status: "FAILED", message: "Invalid license number format" };
        }

        const existing = await Doctor.findOne({
            $or: [
                { licenseNumber: data.licenseNumber },
                { phone: data.phone },
                { email: data.email },
            ]
        });

        if (existing) {
            return { status: "FAILED", message: "Doctor already registered with this license, phone, or email" };
        }

        const passwordHash = await bcrypt.hash(data.password, 10);
        const createdAt    = new Date().toISOString();

        const doctor = new Doctor({
            doctorID:       data.doctorID,
            fullName:       data.fullName,
            licenseNumber:  data.licenseNumber,
            specialization: data.specialization,
            hospitalID:     data.hospitalID,
            phone:          data.phone,
            email:          data.email,
            passwordHash,
            isVerified:     true, // auto-verified after mock license check
            createdAt,
        });

        await doctor.save();

        return { status: "SUCCESS", doctorID: data.doctorID };
    } catch (err) {
        console.error("[Auth] registerDoctor failed:", err);
        return { status: "FAILED", message: err.message };
    }
}

/**
 * Doctor login with password.
 * Returns JWT valid for 8 hours (one shift).
 */
export async function loginDoctorPassword(phone, password) {
    try {
        const doctor = await Doctor.findOne({ phone });

        if (!doctor) {
            return { status: "FAILED", message: "Doctor not found" };
        }

        const valid = await bcrypt.compare(password, doctor.passwordHash);
        if (!valid) {
            return { status: "FAILED", message: "Invalid password" };
        }

        const token = generateToken(
            {
                id:             doctor.doctorID,
                role:           "doctor",
                fullName:       doctor.fullName,
                specialization: doctor.specialization,
                hospitalID:     doctor.hospitalID,
            },
            DOCTOR_JWT_EXP
        );

        return { status: "SUCCESS", token, doctorID: doctor.doctorID };
    } catch (err) {
        return { status: "FAILED", message: err.message };
    }
}

/**
 * Initiate doctor OTP login.
 * Sends OTP to registered phone number.
 */
export async function initiateDoctorOTP(phone) {
    try {
        const doctor = await Doctor.findOne({ phone });

        if (!doctor) {
            return { status: "FAILED", message: "Doctor not found" };
        }

        const otp = generateOTP();

        await OTP.deleteMany({ phone, role: "doctor" }); // clear old OTPs
        await new OTP({ phone, otp, role: "doctor" }).save();

        await sendSMS(phone, `MedVault: Your login OTP is ${otp}. Valid for 5 minutes.`);

        console.log(`[Auth] Doctor OTP for ${phone}: ${otp}`); // dev only

        return { status: "OTP_SENT" };
    } catch (err) {
        return { status: "FAILED", message: err.message };
    }
}

/**
 * Verify doctor OTP and issue JWT.
 */
export async function verifyDoctorOTP(phone, otp) {
    try {
        const record = await OTP.findOne({ phone, role: "doctor" });

        if (!record) {
            return { status: "FAILED", message: "OTP expired or not found" };
        }

        if (record.otp !== otp) {
            return { status: "FAILED", message: "Invalid OTP" };
        }

        await OTP.deleteMany({ phone, role: "doctor" });

        const doctor = await Doctor.findOne({ phone });

        const token = generateToken(
            {
                id:             doctor.doctorID,
                role:           "doctor",
                fullName:       doctor.fullName,
                specialization: doctor.specialization,
                hospitalID:     doctor.hospitalID,
            },
            DOCTOR_JWT_EXP
        );

        return { status: "SUCCESS", token, doctorID: doctor.doctorID };
    } catch (err) {
        return { status: "FAILED", message: err.message };
    }
}

// ── Patient Auth ──────────────────────────────────────────────────────────────

/**
 * Register patient auth record after Fabric registration.
 * Called internally from patient registration flow.
 */
export async function registerPatientAuth(patientID, phone) {
    try {
        const existing = await PatientAuth.findOne({ phone });
        if (existing) {
            return { status: "FAILED", message: "Patient already registered" };
        }

        await new PatientAuth({
            patientID,
            phone,
            createdAt: new Date().toISOString(),
        }).save();

        return { status: "SUCCESS" };
    } catch (err) {
        return { status: "FAILED", message: err.message };
    }
}

/**
 * Initiate patient OTP login via phone number.
 */
export async function initiatePatientOTP(phone) {
    try {
        const patient = await PatientAuth.findOne({ phone });

        if (!patient) {
            return { status: "FAILED", message: "Patient not found. Please register first." };
        }

        const otp = generateOTP();

        await OTP.deleteMany({ phone, role: "patient" });
        await new OTP({ phone, otp, role: "patient" }).save();

        await sendSMS(phone, `MedVault: Your login OTP is ${otp}. Valid for 5 minutes.`);

        console.log(`[Auth] Patient OTP for ${phone}: ${otp}`); // dev only

        return { status: "OTP_SENT" };
    } catch (err) {
        return { status: "FAILED", message: err.message };
    }
}

/**
 * Verify patient OTP and issue JWT valid for 24 hours.
 */
export async function verifyPatientOTP(phone, otp) {
    try {
        const record = await OTP.findOne({ phone, role: "patient" });

        if (!record) {
            return { status: "FAILED", message: "OTP expired or not found" };
        }

        if (record.otp !== otp) {
            return { status: "FAILED", message: "Invalid OTP" };
        }

        await OTP.deleteMany({ phone, role: "patient" });

        const patient = await PatientAuth.findOne({ phone });

        const token = generateToken(
            {
                id:   patient.patientID,
                role: "patient",
            },
            PATIENT_JWT_EXP
        );

        return { status: "SUCCESS", token, patientID: patient.patientID };
    } catch (err) {
        return { status: "FAILED", message: err.message };
    }
}
