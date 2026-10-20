import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { Doctor, OrgActor, PatientAuth, OTP } from "./db.js";
import { sendSMS } from "./notificationService.js";
import { generateID } from "./idService.js";

const DEV_JWT_SECRET   = "medvault-dev-secret-change-in-prod";
// `||` (not `??`) so an empty JWT_SECRET= line in .env also counts as unset.
const JWT_SECRET       = process.env.JWT_SECRET || DEV_JWT_SECRET;
if (process.env.NODE_ENV === "production" && JWT_SECRET === DEV_JWT_SECRET) {
    throw new Error("JWT_SECRET must be set when NODE_ENV=production.");
}
const MAX_OTP_ATTEMPTS = 5;
const DOCTOR_JWT_EXP   = "8h";
const PATIENT_JWT_EXP  = "24h";
const ORG_ACTOR_JWT_EXP = "8h";

// ── Helpers ───────────────────────────────────────────────────────────────────

function generateOTP() {
    if (process.env.NODE_ENV === "test") {
        return "123456";
    }
    return Math.floor(100000 + Math.random() * 900000).toString();
}

function generateToken(payload, expiresIn) {
    return jwt.sign(payload, JWT_SECRET, { expiresIn });
}

export function verifyToken(token) {
    return jwt.verify(token, JWT_SECRET);
}

/**
 * Check an OTP guess. The attempt is counted atomically BEFORE comparing, so
 * parallel guesses can't slip past the limit. After MAX_OTP_ATTEMPTS the OTP
 * is deleted and a new one must be requested (even the correct code fails).
 */
async function checkOTP(phone, role, otp) {
    const record = await OTP.findOneAndUpdate(
        { phone, role },
        { $inc: { attempts: 1 } },
        { new: true }
    );
    if (!record) {
        return { ok: false, message: "OTP expired or not found" };
    }
    if (record.attempts > MAX_OTP_ATTEMPTS) {
        await OTP.deleteMany({ phone, role });
        return { ok: false, message: "Too many incorrect attempts. Request a new OTP." };
    }
    if (record.otp !== otp) {
        return { ok: false, message: "Invalid OTP" };
    }
    return { ok: true };
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
        const doctor = await Doctor.findOne({ $or: [{ phone }, { email: phone }] });

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
        const doctor = await Doctor.findOne({ $or: [{ phone }, { email: phone }] });
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
        const check = await checkOTP(phone, "doctor", otp);
        if (!check.ok) {
            return { status: "FAILED", message: check.message };
        }

        await OTP.deleteMany({ phone, role: "doctor" });

        const doctor = await Doctor.findOne({ $or: [{ phone }, { email: phone }] });
        if (!doctor) {
            return { status: "FAILED", message: "Doctor not found" };
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

// ── Patient Auth ──────────────────────────────────────────────────────────────

/**
 * Register patient auth record after Fabric registration.
 * Called internally from patient registration flow.
 */
export function generatePatientAuthToken(patientID) {
    return generateToken({ id: patientID, role: "patient" }, PATIENT_JWT_EXP);
}
export async function registerPatientAuth(patientID, phone, aadhaarHash) {
    try {
        const existing = await PatientAuth.findOne({ phone });
        if (existing) {
            return { status: "FAILED", message: "Patient already registered" };
        }

        await new PatientAuth({
            patientID,
            phone,
            aadhaarHash,
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
        const check = await checkOTP(phone, "patient", otp);
        if (!check.ok) {
            return { status: "FAILED", message: check.message };
        }

        await OTP.deleteMany({ phone, role: "patient" });

        const patient = await PatientAuth.findOne({ phone });
        if (!patient) {
            return { status: "FAILED", message: "Patient not found" };
        }

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

// ── Org Actor Auth (pharmacist, lab-tech) ──────────────────────────────────────
// Thin account type for partner-org staff. Authorization for cross-org record
// access comes from patient consent (Consent.granteeOrg) checked on-chain, not
// from anything in this profile — org is what matters, not the individual.

const VALID_ORG_ACTOR_ORGS = ["PharmacyMSP", "LaboratoryMSP", "GovernanceMSP"];

/**
 * Register a new org actor (pharmacist/lab-tech).
 */
export async function registerOrgActor(data) {
    try {
        if (!VALID_ORG_ACTOR_ORGS.includes(data.org)) {
            return { status: "FAILED", message: `org must be one of: ${VALID_ORG_ACTOR_ORGS.join(", ")}` };
        }

        const existing = await OrgActor.findOne({
            $or: [{ phone: data.phone }, { email: data.email }],
        });

        if (existing) {
            return { status: "FAILED", message: "Org actor already registered with this phone or email" };
        }

        const passwordHash = await bcrypt.hash(data.password, 10);
        const actorID       = generateID("orgActor");
        const createdAt     = new Date().toISOString();

        const orgActor = new OrgActor({
            actorID,
            fullName: data.fullName,
            org:      data.org,
            phone:    data.phone,
            email:    data.email,
            passwordHash,
            createdAt,
        });

        await orgActor.save();

        return { status: "SUCCESS", actorID };
    } catch (err) {
        console.error("[Auth] registerOrgActor failed:", err);
        return { status: "FAILED", message: err.message };
    }
}

/**
 * Org actor login with password. Returns JWT valid for 8 hours.
 * JWT carries `org` (MSP ID) — the field the consent gate cares about.
 */
export async function loginOrgActorPassword(phone, password) {
    try {
        const orgActor = await OrgActor.findOne({ phone });

        if (!orgActor) {
            return { status: "FAILED", message: "Org actor not found" };
        }

        const valid = await bcrypt.compare(password, orgActor.passwordHash);
        if (!valid) {
            return { status: "FAILED", message: "Invalid password" };
        }

        const token = generateToken(
            {
                id:       orgActor.actorID,
                role:     "org_actor",
                org:      orgActor.org,
                fullName: orgActor.fullName,
            },
            ORG_ACTOR_JWT_EXP
        );

        return { status: "SUCCESS", token, actorID: orgActor.actorID, org: orgActor.org };
    } catch (err) {
        return { status: "FAILED", message: err.message };
    }
}
