import express from "express";

import * as uidaiService from "../services/uidaiService.js";
import * as patientFabricService from "../services/patientFabricService.js";

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
        patientID,
        fullName,
        dob,
        gender,
        phone,
        email
    } = req.body;

    if (
        !transactionID ||
        !otp ||
        !patientID ||
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

            patientID,
            fullName,
            dob,
            gender,

            aadhaarVID: uidaiResult.aadhaarVID,
            aadhaarToken: uidaiResult.aadhaarToken,

            phone,
            email,

            createdAt: timestamp,
            updatedAt: timestamp

        });

    if (fabricResult.status !== "SUCCESS") {
        return res.status(500).json(fabricResult);
    }

    return res.json({

        status: "SUCCESS",

        message: "Patient registered successfully.",

        patient: {

            patientID: fabricResult.patientID,

            fullName,

            aadhaarVID: fabricResult.aadhaarVID,

            aadhaarToken: fabricResult.aadhaarToken,

            registeredAt: timestamp

        }

    });

});
router.get("/:id", async (req, res) => {
    const result = await patientFabricService.getPatient(req.params.id);
    res.json(result);
});

export default router;
