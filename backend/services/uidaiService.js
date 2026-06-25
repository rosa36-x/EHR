import aadhaarDB from "../data/aadhaar_db.json" with { type: "json" };
import otpStore from "../temp/otpStore.js";

function generateOTP() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

function generateTransactionID() {
    return "TXN" + Date.now();
}

function authenticate(aadhaarNumber, dob) {
    const record = aadhaarDB.find(
        user =>
            user.aadhaarNumber === aadhaarNumber &&
            user.dob === dob
    );

    if (!record) {
        return {
            status: "FAILED",
            message: "Demographic verification failed"
        };
    }

    const transactionID = generateTransactionID();
    const otp = generateOTP();

    otpStore[transactionID] = {
        otp,
        aadhaarNumber,
        expiresAt: Date.now() + (5 * 60 * 1000)
    };

    console.log(`OTP for ${aadhaarNumber}: ${otp}`);

    return {
        status: "OTP_SENT",
        transactionID
    };
}

function generateVID() {
    return "VID-" + Math.random().toString(36).substring(2, 14).toUpperCase();
}

function generateToken() {
    return "TOK-" + Math.random().toString(36).substring(2, 14).toUpperCase();
}

function verifyOTP(transactionID, otp) {
    const record = otpStore[transactionID];

    if (!record) {
        return {
            status: "FAILED",
            message: "Invalid transaction ID"
        };
    }

    if (Date.now() > record.expiresAt) {
        delete otpStore[transactionID];
        return {
            status: "FAILED",
            message: "OTP expired"
        };
    }

    if (record.otp !== otp) {
        return {
            status: "FAILED",
            message: "Invalid OTP"
        };
    }

    const aadhaarVID = generateVID();
    const aadhaarToken = generateToken();

    delete otpStore[transactionID];

    return {
        status: "SUCCESS",
        aadhaarVID,
        aadhaarToken
    };
}

function authenticateBiometric(fingerprintTemplate) {
    const record = aadhaarDB.find(
        user => user.fingerprintTemplate === fingerprintTemplate
    );

    if (!record) {
        return {
            status: "FAILED",
            message: "Biometric authentication failed"
        };
    }

    const aadhaarVID = generateVID();
    const aadhaarToken = generateToken();

    return {
        status: "SUCCESS",
        fullName: record.fullName,
        aadhaarVID,
        aadhaarToken
    };
}

export {
    authenticate,
    verifyOTP,
    authenticateBiometric
};