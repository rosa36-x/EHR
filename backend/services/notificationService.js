import nodemailer from "nodemailer";
import { Notification } from "./db.js";

/**
 * Notification Service
 * SMS:   MSG91 (India-optimized, TRAI compliant)
 * Email: Nodemailer with Gmail SMTP
 *
 * Set these in your .env:
 *   MSG91_AUTH_KEY=your_msg91_key
 *   MSG91_SENDER_ID=MEDVLT
 *   MSG91_TEMPLATE_ID=your_template_id
 *   GMAIL_USER=your@gmail.com
 *   GMAIL_PASS=your_app_password
 */

// ── SMS via MSG91 ─────────────────────────────────────────────────────────────

/**
 * Send an SMS via MSG91.
 * @param {string} phone - Indian mobile number (10 digits, no country code)
 * @param {string} message - SMS text
 */
export async function sendSMS(phone, message) {
    try {
        const authKey    = process.env.MSG91_AUTH_KEY;
        const senderID   = process.env.MSG91_SENDER_ID ?? "MEDVLT";
        const templateID = process.env.MSG91_TEMPLATE_ID;

        if (!authKey) {
            // Dev mode — just log
            console.log(`[SMS] To: ${phone} | Message: ${message}`);
            return { status: "SUCCESS", mode: "dev" };
        }

        const response = await fetch("https://api.msg91.com/api/v5/flow/", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "authkey": authKey,
            },
            body: JSON.stringify({
                template_id: templateID,
                sender:      senderID,
                short_url:   "0",
                mobiles:     `91${phone}`,
                VAR1:        message,
            }),
        });

        const data = await response.json();
        console.log(`[SMS] Sent to ${phone}:`, data);
        return { status: "SUCCESS", data };
    } catch (err) {
        console.error("[SMS] Failed:", err);
        return { status: "FAILED", message: err.message };
    }
}

// ── Email via Nodemailer ──────────────────────────────────────────────────────

const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_PASS,
    },
});

/**
 * Send an email via Gmail SMTP.
 * @param {string} to - Recipient email
 * @param {string} subject - Email subject
 * @param {string} text - Email body
 */
export async function sendEmail(to, subject, text) {
    try {
        if (!process.env.GMAIL_USER) {
            console.log(`[Email] To: ${to} | Subject: ${subject} | Body: ${text}`);
            return { status: "SUCCESS", mode: "dev" };
        }

        await transporter.sendMail({
            from:    `"MedVault" <${process.env.GMAIL_USER}>`,
            to,
            subject,
            text,
        });

        console.log(`[Email] Sent to ${to}`);
        return { status: "SUCCESS" };
    } catch (err) {
        console.error("[Email] Failed:", err);
        return { status: "FAILED", message: err.message };
    }
}

// ── Notification Events ───────────────────────────────────────────────────────

/**
 * Send a notification for a specific event and persist to MongoDB.
 *
 * @param {object} params
 * @param {string} params.recipientID   - patientID or doctorID
 * @param {string} params.recipientRole - "patient" or "doctor"
 * @param {string} params.phone         - recipient phone
 * @param {string} params.email         - recipient email (optional)
 * @param {string} params.event         - event type key
 * @param {string} params.message       - notification message text
 * @param {string} params.channel       - "sms" | "email" | "both"
 */
export async function notify({ recipientID, recipientRole, phone, email, event, message, channel = "sms" }) {
    let status = "SENT";

    try {
        if (channel === "sms" || channel === "both") {
            const result = await sendSMS(phone, message);
            if (result.status !== "SUCCESS") status = "FAILED";
        }

        if ((channel === "email" || channel === "both") && email) {
            const result = await sendEmail(email, `MedVault — ${event}`, message);
            if (result.status !== "SUCCESS") status = "FAILED";
        }
    } catch (err) {
        status = "FAILED";
        console.error("[Notify] Failed:", err);
    }

    // Always persist notification regardless of delivery status
    try {
        await new Notification({
            recipientID,
            recipientRole,
            phone,
            email,
            event,
            message,
            channel,
            status,
            createdAt: new Date().toISOString(),
        }).save();
    } catch (err) {
        console.error("[Notify] Failed to persist notification:", err);
    }

    return { status };
}

// ── Predefined Event Messages ─────────────────────────────────────────────────

export const NotificationEvents = {
    RECORD_ACCESSED: (resourceType, doctorName) =>
        `Your ${resourceType} record was accessed by Dr. ${doctorName}.`,

    SENSITIVE_RECORD_ACCESS_REQUEST: (doctorName, resourceType) =>
        `Dr. ${doctorName} has requested access to your sensitive ${resourceType} record. You have 24 hours to approve or reject.`,

    PERMISSION_GRANTED: (patientName, resourceType) =>
        `${patientName} has approved your request to access their ${resourceType} record.`,

    PERMISSION_REJECTED: (patientName, resourceType) =>
        `${patientName} has rejected your request to access their ${resourceType} record.`,

    PERMISSION_EXPIRED: (resourceType) =>
        `Your access request for ${resourceType} record has expired with no patient response.`,

    CONSENT_GRANTED: (granteeOrg, resourceType) =>
        `You have granted ${granteeOrg} access to your ${resourceType} records.`,

    CONSENT_REVOKED: (granteeOrg, resourceType) =>
        `Your consent for ${granteeOrg} to access your ${resourceType} records has been revoked.`,

    PRESCRIPTION_DISPENSED: (prescriptionID) =>
        `Your prescription ${prescriptionID} has been dispensed by the pharmacy.`,

    LAB_REPORT_UPLOADED: (reportType) =>
        `Your ${reportType} lab report has been uploaded and is now available.`,

    EMERGENCY_ACCESS: (doctorName, reason) =>
        `Emergency access to your records was granted to Dr. ${doctorName}. Reason: ${reason}.`,

    TREATMENT_RELATIONSHIP_ENDED: (doctorName) =>
        `Your treatment relationship with Dr. ${doctorName} has ended. Their access to your records has been revoked.`,
};
