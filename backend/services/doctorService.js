import { Doctor } from "./db.js";
import { generateID } from "./idService.js";
import { registerDoctor } from "./authService.js";

/**
 * Doctor Service
 * Handles doctor registration and profile management.
 * All doctors share HospitalMSP Fabric identity —
 * doctor identity is tracked at the application layer only.
 */

/**
 * Register a new doctor.
 * Generates doctorID, validates license (mock), saves to MongoDB.
 */
export async function createDoctor(data) {
    try {
        const doctorID = generateID("doctor");

        const result = await registerDoctor({
            ...data,
            doctorID,
        });

        return result;
    } catch (err) {
        console.error("[DoctorService] createDoctor failed:", err);
        return { status: "FAILED", message: err.message };
    }
}

/**
 * Get a doctor's profile by doctorID.
 * Never returns passwordHash.
 */
export async function getDoctorByID(doctorID) {
    try {
        const doctor = await Doctor.findOne({ doctorID }).select("-passwordHash");

        if (!doctor) {
            return { status: "FAILED", message: "Doctor not found" };
        }

        return { status: "SUCCESS", data: doctor };
    } catch (err) {
        return { status: "FAILED", message: err.message };
    }
}

/**
 * Get a doctor's profile by phone number.
 */
export async function getDoctorByPhone(phone) {
    try {
        const doctor = await Doctor.findOne({ phone }).select("-passwordHash");

        if (!doctor) {
            return { status: "FAILED", message: "Doctor not found" };
        }

        return { status: "SUCCESS", data: doctor };
    } catch (err) {
        return { status: "FAILED", message: err.message };
    }
}

/**
 * List all doctors in a hospital.
 */
export async function getDoctorsByHospital(hospitalID) {
    try {
        const doctors = await Doctor.find({ hospitalID }).select("-passwordHash");
        return { status: "SUCCESS", data: doctors };
    } catch (err) {
        return { status: "FAILED", message: err.message };
    }
}

/**
 * Mock NMC license validation.
 * Format check only — alphanumeric, 5-15 chars.
 * Replace with real NMC API call in production.
 */
export function validateLicense(licenseNumber) {
    return /^[A-Z0-9]{5,15}$/.test(licenseNumber);
}