import express from "express";

import * as uidaiService from "../services/uidaiService.js";
import * as patientFabricService from "../services/patientFabricService.js";
import { authenticate } from "../services/authMiddleware.js";
import { generatePatientAuthToken } from "../services/authService.js";
import { PatientAuth } from "../services/db.js";
const router = express.Router();

/**
 * Step 1:
 * Aadhaar + DOB verification
 * Generates OTP
 */
router.post("/initiate-registration", (req, res) => {

    const { aadhaarNumber, dob } = req.body;

    if (!aadhaarNumber || !dob) {
        return res.status(400).json({
            status: "FAILED",
            message: "aadhaarNumber and dob are required."
        });
    }

    const result = uidaiService.authenticate(
        aadhaarNumber,
        dob
    );

    return res.json(result);

});

/**
 * Step 2:
 * OTP verification + Patient Registration
 */
router.post("/complete-registration", async (req, res) => {

    const {
        transactionID,
        otp,
        fullName,
        dob,
        gender,
        phone,
        email
    } = req.body;

    if (
        !transactionID ||
        !otp ||
        !fullName ||
        !dob ||
        !gender ||
        !phone ||
        !email
    ) {
        return res.status(400).json({
            status: "FAILED",
            message: "Missing required registration fields."
        });
    }

    const uidaiResult = uidaiService.verifyOTP(
        transactionID,
        otp
    );

    if (uidaiResult.status !== "SUCCESS") {
        return res.status(400).json(uidaiResult);
    }

    const timestamp = new Date().toISOString();

    const fabricResult =
        await patientFabricService.createPatient({

            fullName,
            dob,
            gender,

            aadhaarVID: uidaiResult.aadhaarVID,
            aadhaarToken: uidaiResult.aadhaarToken,
            aadhaarHash: uidaiResult.aadhaarHash,

            phone,
            email,

            createdAt: timestamp,
            updatedAt: timestamp

        });

    if (fabricResult.status === "DUPLICATE") {
        return res.status(409).json(fabricResult);
    }
    if (fabricResult.status !== "SUCCESS") {
        return res.status(500).json(fabricResult);
    }

    return res.json({
        status: "SUCCESS",
        message: "Patient registered successfully.",
        token: generatePatientAuthToken(fabricResult.patientID),
        patient: {
            patientID: fabricResult.patientID,
            fullName,
            aadhaarVID: fabricResult.aadhaarVID,
            aadhaarToken: fabricResult.aadhaarToken,
            registeredAt: timestamp
        }
    });

});
router.get("/:id", authenticate, async (req, res) => {
    const result = await patientFabricService.getPatient(req.params.id, req.user.id, req.user.role);
    return res.status(result.status === "SUCCESS" ? 200 : 403).json(result);
});
/**
 * POST /patients/resolve-biometric
 * Body: { fingerprintTemplate }
 * For unidentified/unconscious patients: resolves a biometric scan to a
 * real, already-registered patientID via the stable aadhaarHash — used to
 * bootstrap emergency access when the doctor doesn't have a patientID yet.
 */
router.post("/resolve-biometric", authenticate, async (req, res) => {
    const { fingerprintTemplate } = req.body;

    if (!fingerprintTemplate) {
        return res.status(400).json({
            status: "FAILED",
            message: "fingerprintTemplate is required.",
        });
    }

    const bioResult = uidaiService.authenticateBiometric(fingerprintTemplate);
    if (bioResult.status !== "SUCCESS") {
        return res.status(400).json(bioResult);
    }

    const patient = await PatientAuth.findOne({ aadhaarHash: bioResult.aadhaarHash });
    if (!patient) {
        return res.status(404).json({
            status: "FAILED",
            message: "Biometric identity verified, but no MedVault account is registered for this person.",
        });
    }

    return res.json({
        status: "SUCCESS",
        patientID: patient.patientID,
        fullName: bioResult.fullName,
    });
});

router.get("/", authenticate, async (req, res) => {
    if (req.user.role !== "doctor") {
        return res.status(403).json({ status: "ACCESS_DENIED", message: "Only doctors can search patients." });
    }
    const { search } = req.query;
    if (!search) {
        return res.status(400).json({ status: "FAILED", message: "search query param is required." });
    }
    const result = await patientFabricService.searchPatientsByName(search);
    return res.status(result.status === "SUCCESS" ? 200 : 500).json(result);
});
export default router;
