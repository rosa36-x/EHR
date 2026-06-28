import crypto from "crypto";
import { getContract } from "./fabricService.js";
import { encryptDocument, decryptDocument } from "./kmsService.js";
import { uploadFile, getFile } from "./ipfsService.js";
import { logAudit } from "./auditMiddleware.js";
import { getSensitivityLevel, isValidRecordType } from "./sensitivityService.js";
import { hasActiveTreatmentRelationship } from "./treatmentRelationshipFabricService.js";
import { hasActivePermission, createPermissionRequest } from "./permissionRequestFabricService.js";
import { notify, NotificationEvents } from "./notificationService.js";
import { PatientAuth, Doctor } from "./db.js";

export async function createConsultation(data, fileBuffer, actorID) {
    let gateway, client;
    try {
        if (!isValidRecordType("CONSULTATION", data.recordType)) {
            return { status: "FAILED", message: `Invalid recordType: ${data.recordType}` };
        }

        const sensitivityLevel = getSensitivityLevel(data.recordType);

        const { encryptedBuffer, keyRef } = await encryptDocument(fileBuffer);
        const consultationCID  = await uploadFile(encryptedBuffer);
        const consultationHash = crypto.createHash("sha256").update(fileBuffer).digest("hex");

        const result = await getContract("hospital");
        gateway = result.gateway;
        client  = result.client;
        const { contract } = result;

        const timestamp = new Date().toISOString();

        await contract.submitTransaction(
            "CreateConsultation",
            data.consultationID,
            data.patientID,
            data.doctorID,
            data.diagnosis,
            data.recordType,
            sensitivityLevel,
            consultationCID,
            consultationHash,
            keyRef,
            timestamp,
            timestamp,
            timestamp
        );

        await logAudit({
            actorID:      actorID ?? data.doctorID,
            actorRole:    "doctor",
            action:       "CREATE",
            resourceType: "CONSULTATION",
            resourceID:   data.patientID,
        });

        // Notify patient
        const patient = await PatientAuth.findOne({ patientID: data.patientID });
        const doctor  = await Doctor.findOne({ doctorID: data.doctorID });
        if (patient && doctor) {
            await notify({
                recipientID:   data.patientID,
                recipientRole: "patient",
                phone:         patient.phone,
                event:         "RECORD_ACCESSED",
                message:       NotificationEvents.RECORD_ACCESSED("consultation", doctor.fullName),
                channel:       "sms",
            });
        }

        return {
            status:           "SUCCESS",
            consultationID:   data.consultationID,
            consultationCID,
            consultationHash,
            sensitivityLevel,
            encryptionKeyRef: keyRef,
        };
    } catch (err) {
        await logAudit({
            actorID:      actorID ?? data.doctorID,
            actorRole:    "doctor",
            action:       "ACCESS_FAILED",
            resourceType: "CONSULTATION",
            resourceID:   data.patientID,
        });
        console.error("[Consultation] createConsultation failed:", err);
        return { status: "FAILED", message: err.message };
    } finally {
        if (gateway) await gateway.close();
        if (client)  client.close();
    }
}

export async function getConsultation(consultationID, actorID, actorRole) {
    let gateway, client;
    try {
        const result = await getContract("hospital");
        gateway = result.gateway;
        client  = result.client;
        const { contract } = result;

        const raw  = await contract.evaluateTransaction("GetConsultation", consultationID);
        const data = JSON.parse(Buffer.from(raw).toString("utf8"));

        // Sensitivity + access check
        if (data.sensitivityLevel === "SENSITIVE") {
            const hasPermission = await hasActivePermission(actorID, consultationID);
            if (!hasPermission) {
                await logAudit({
                    actorID,
                    actorRole,
                    action:       "ACCESS_DENIED",
                    resourceType: "CONSULTATION",
                    resourceID:   consultationID,
                });
                return {
                    status:  "ACCESS_DENIED",
                    message: "This is a sensitive record. Please request patient permission first.",
                    requiresPermission: true,
                    resourceID: consultationID,
                    resourceType: "CONSULTATION",
                };
            }
        } else {
            // Normal record — check treatment relationship
            const hasRelationship = await hasActiveTreatmentRelationship(actorID, data.patientID);
            if (!hasRelationship) {
                await logAudit({
                    actorID,
                    actorRole,
                    action:       "ACCESS_DENIED",
                    resourceType: "CONSULTATION",
                    resourceID:   consultationID,
                });
                return {
                    status:  "ACCESS_DENIED",
                    message: "No active treatment relationship with this patient.",
                };
            }
        }

        await logAudit({
            actorID,
            actorRole,
            action:       "READ",
            resourceType: "CONSULTATION",
            resourceID:   consultationID,
        });

        return { status: "SUCCESS", data };
    } catch (err) {
        return { status: "FAILED", message: err.message };
    } finally {
        if (gateway) await gateway.close();
        if (client)  client.close();
    }
}

export async function getConsultationDocument(consultationID, actorID, actorRole) {
    let gateway, client;
    try {
        const result = await getContract("hospital");
        gateway = result.gateway;
        client  = result.client;
        const { contract } = result;

        const raw = await contract.evaluateTransaction("GetConsultation", consultationID);
        const { consultationCID, encryptionKeyRef, sensitivityLevel, patientID } = JSON.parse(
            Buffer.from(raw).toString("utf8")
        );

        if (sensitivityLevel === "SENSITIVE") {
            const hasPermission = await hasActivePermission(actorID, consultationID);
            if (!hasPermission) {
                await logAudit({
                    actorID, actorRole,
                    action: "ACCESS_DENIED",
                    resourceType: "CONSULTATION",
                    resourceID: consultationID,
                });
                return {
                    status: "ACCESS_DENIED",
                    message: "This is a sensitive record. Please request patient permission first.",
                    requiresPermission: true,
                    resourceID: consultationID,
                    resourceType: "CONSULTATION",
                };
            }
        } else {
            const hasRelationship = await hasActiveTreatmentRelationship(actorID, patientID);
            if (!hasRelationship) {
                await logAudit({ actorID, actorRole, action: "ACCESS_DENIED", resourceType: "CONSULTATION", resourceID: consultationID });
                return { status: "ACCESS_DENIED", message: "No active treatment relationship with this patient." };
            }
        }

        const encryptedBuffer = await getFile(consultationCID);
        const plaintext       = await decryptDocument(encryptedBuffer, encryptionKeyRef);

        await logAudit({ actorID, actorRole, action: "READ", resourceType: "CONSULTATION", resourceID: consultationID });

        return { status: "SUCCESS", document: plaintext };
    } catch (err) {
        return { status: "FAILED", message: err.message };
    } finally {
        if (gateway) await gateway.close();
        if (client)  client.close();
    }
}

export async function updateConsultation(data, fileBuffer, actorID) {
    let gateway, client;
    try {
        const { encryptedBuffer, keyRef } = await encryptDocument(fileBuffer);
        const consultationCID  = await uploadFile(encryptedBuffer);
        const consultationHash = crypto.createHash("sha256").update(fileBuffer).digest("hex");

        const result = await getContract("hospital");
        gateway = result.gateway;
        client  = result.client;
        const { contract } = result;

        const updatedAt = new Date().toISOString();

        await contract.submitTransaction(
            "UpdateConsultation",
            data.consultationID,
            data.diagnosis,
            consultationCID,
            consultationHash,
            keyRef,
            updatedAt
        );

        await logAudit({
            actorID:      actorID ?? data.doctorID,
            actorRole:    "doctor",
            action:       "UPDATE",
            resourceType: "CONSULTATION",
            resourceID:   data.consultationID,
        });

        return { status: "SUCCESS", consultationID: data.consultationID, consultationCID, consultationHash, encryptionKeyRef: keyRef };
    } catch (err) {
        return { status: "FAILED", message: err.message };
    } finally {
        if (gateway) await gateway.close();
        if (client)  client.close();
    }
}
