import crypto from "crypto";
import { getContract } from "./fabricService.js";
import { encryptDocument, decryptDocument } from "./kmsService.js";
import { uploadFile, getFile } from "./ipfsService.js";
import { logAudit } from "./auditMiddleware.js";
import { getSensitivityLevel, isValidRecordType } from "./sensitivityService.js";
import { hasActivePermission } from "./permissionRequestFabricService.js";
import { notify, NotificationEvents } from "./notificationService.js";
import { PatientAuth, Doctor } from "./db.js";

export async function createReferral(data, fileBuffer, actorID) {
    let gateway, client;
    try {
        if (!isValidRecordType("REFERRAL", data.referralType)) {
            return { status: "FAILED", message: `Invalid referralType: ${data.referralType}` };
        }

        const sensitivityLevel = getSensitivityLevel(data.referralType);

        const { encryptedBuffer, keyRef } = await encryptDocument(fileBuffer);
        const referralCID  = await uploadFile(encryptedBuffer);
        const referralHash = crypto.createHash("sha256").update(fileBuffer).digest("hex");

        const result = await getContract("hospital");
        gateway = result.gateway;
        client  = result.client;
        const { contract } = result;

        const timestamp = new Date().toISOString();

        await contract.submitTransaction(
            "CreateReferral",
            data.referralID,
            data.patientID,
            data.fromDoctorID,
            data.toDoctorID,
            referralCID,
            referralHash,
            keyRef,
            data.referralReason,
            timestamp,
            timestamp
        );

        await logAudit({
            actorID:      actorID ?? data.fromDoctorID,
            actorRole:    "doctor",
            action:       "CREATE",
            resourceType: "REFERRAL",
            resourceID:   data.patientID,
        });

        // Notify patient
        const patient = await PatientAuth.findOne({ patientID: data.patientID });
        const doctor  = await Doctor.findOne({ doctorID: data.fromDoctorID });
        if (patient && doctor) {
            await notify({
                recipientID:   data.patientID,
                recipientRole: "patient",
                phone:         patient.phone,
                event:         "RECORD_ACCESSED",
                message:       NotificationEvents.RECORD_ACCESSED("referral", doctor.fullName),
                channel:       "sms",
            });
        }

        return {
            status:           "SUCCESS",
            referralID:       data.referralID,
            referralCID,
            referralHash,
            sensitivityLevel,
            encryptionKeyRef: keyRef,
        };
    } catch (err) {
        await logAudit({
            actorID:      actorID ?? data.fromDoctorID,
            actorRole:    "doctor",
            action:       "ACCESS_FAILED",
            resourceType: "REFERRAL",
            resourceID:   data.patientID,
        });
        return { status: "FAILED", message: err.message };
    } finally {
        if (gateway) await gateway.close();
        if (client)  client.close();
    }
}

export async function getReferral(referralID, actorID, actorRole) {
    let gateway, client;
    try {
        const result = await getContract("hospital");
        gateway = result.gateway;
        client  = result.client;
        const { contract } = result;

        const raw  = await contract.evaluateTransaction("GetReferral", referralID);
        const data = JSON.parse(Buffer.from(raw).toString("utf8"));

        if (data.sensitivityLevel === "SENSITIVE") {
            const hasPermission = await hasActivePermission(actorID, referralID);
            if (!hasPermission) {
                await logAudit({ actorID, actorRole, action: "ACCESS_DENIED", resourceType: "REFERRAL", resourceID: referralID });
                return { status: "ACCESS_DENIED", message: "This is a sensitive record. Please request patient permission first.", requiresPermission: true, resourceID: referralID, resourceType: "REFERRAL" };
            }
        }

        await logAudit({ actorID, actorRole, action: "READ", resourceType: "REFERRAL", resourceID: referralID });

        return { status: "SUCCESS", data };
    } catch (err) {
        return { status: "FAILED", message: err.message };
    } finally {
        if (gateway) await gateway.close();
        if (client)  client.close();
    }
}

export async function getReferralDocument(referralID, actorID, actorRole) {
    let gateway, client;
    try {
        const result = await getContract("hospital");
        gateway = result.gateway;
        client  = result.client;
        const { contract } = result;

        const raw = await contract.evaluateTransaction("GetReferral", referralID);
        const { referralCID, encryptionKeyRef, sensitivityLevel } = JSON.parse(
            Buffer.from(raw).toString("utf8")
        );

        if (sensitivityLevel === "SENSITIVE") {
            const hasPermission = await hasActivePermission(actorID, referralID);
            if (!hasPermission) {
                await logAudit({ actorID, actorRole, action: "ACCESS_DENIED", resourceType: "REFERRAL", resourceID: referralID });
                return { status: "ACCESS_DENIED", message: "This is a sensitive record. Please request patient permission first.", requiresPermission: true, resourceID: referralID, resourceType: "REFERRAL" };
            }
        }

        const encryptedBuffer = await getFile(referralCID);
        const plaintext       = await decryptDocument(encryptedBuffer, encryptionKeyRef);

        await logAudit({ actorID, actorRole, action: "READ", resourceType: "REFERRAL", resourceID: referralID });

        return { status: "SUCCESS", document: plaintext };
    } catch (err) {
        return { status: "FAILED", message: err.message };
    } finally {
        if (gateway) await gateway.close();
        if (client)  client.close();
    }
}
