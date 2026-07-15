import crypto from "crypto";
import aadhaarDB from "../data/aadhaar_db.json" with { type: "json" };
import otpStore from "../temp/otpStore.js";

// Keyed hash so re-registration under a different phone can be detected by
// comparing hashes, without ever persisting the raw Aadhaar number anywhere
// (matches the project's existing "raw Aadhaar never stored" rule). Uses a
// server secret rather than a random salt so the same Aadhaar number always
// produces the same hash and can be looked up by equality.
//
// The dev fallback below is ONLY for local/test convenience. In production,
// a missing secret would mean every deployment silently shares the same
// publicly-known key (since it would be sitting in this file in the repo),
// which defeats the point of hashing — anyone could precompute hashes for
// guessed Aadhaar numbers and match them against the database. So instead
// of silently falling back, we refuse to start.
if (!process.env.AADHAAR_HASH_SECRET && process.env.NODE_ENV === "production") {
    throw new Error(
        "AADHAAR_HASH_SECRET must be set in production. Generate one with: openssl rand -hex 32"
    );
}
const AADHAAR_HASH_SECRET = process.env.AADHAAR_HASH_SECRET ?? "dev-only-insecure-secret-change-in-prod";

function hashAadhaar(aadhaarNumber) {
    return crypto.createHmac("sha256", AADHAAR_HASH_SECRET).update(aadhaarNumber).digest("hex");
}

function generateOTP() {
    if (process.env.NODE_ENV === "test") {
        return "123456";
    }
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
    const aadhaarHash = hashAadhaar(record.aadhaarNumber);

    delete otpStore[transactionID];

    return {
        status: "SUCCESS",
        aadhaarVID,
        aadhaarToken,
        aadhaarHash
    };
}


export {
    authenticate,
    verifyOTP,
    authenticateBiometric
};
function authenticateBiometric(fingerprintTemplate) {
    const record = aadhaarDB.find(
        user => user.fingerprintTemplate === fingerprintTemplate
    );
    if (!record) {
        return { status: "FAILED", message: "Biometric authentication failed" };
    }
    const aadhaarVID = generateVID();
    const aadhaarToken = generateToken();
    const aadhaarHash = hashAadhaar(record.aadhaarNumber);
    return { status: "SUCCESS", fullName: record.fullName, aadhaarVID, aadhaarToken, aadhaarHash };
}