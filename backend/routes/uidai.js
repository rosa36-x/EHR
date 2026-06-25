import express from "express";

import {
    authenticate,
    verifyOTP,
    authenticateBiometric
} from "../services/uidaiService.js";

const router = express.Router();

router.get("/health", (req, res) => {
    res.json({
        status: "UIDAI Mock Service Active"
    });
});

router.post("/authenticate", (req, res) => {
    const { aadhaarNumber, dob } = req.body;

    const result = authenticate(aadhaarNumber, dob);

    res.json(result);
});

router.post("/verify-otp", (req, res) => {
    const { transactionID, otp } = req.body;

    const result = verifyOTP(transactionID, otp);

    res.json(result);
});

router.post("/authenticate-biometric", (req, res) => {
    const { fingerprintTemplate } = req.body;

    const result = authenticateBiometric(fingerprintTemplate);

    res.json(result);
});

export default router;