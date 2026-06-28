import crypto from "crypto";
import { getContract } from "./fabricService.js";
import { encryptDocument, decryptDocument } from "./kmsService.js";
import { uploadFile, getFile } from "./ipfsService.js";
import { logAudit } from "./auditMiddleware.js";
import { getSensitivityLevel, isValidRecordType } from "./sensitivityService.js";
import { hasActiveTreatmentRelationship } from "./treatmentRelationshipFabricService.js";
import { hasActivePermission } from "./permissionRequestFabricService.js";
import { notify, NotificationEvents } from "./notificationService.js";
import { PatientAuth } from "./db.js";

export async function createLabReport(data, fileBuffer, actorID) {
    let gateway, client;
    try {
        if (!isValidRecordType("LAB_REPORT", data.reportType)) {
            return { status: "FAILED", message: `Invalid reportType: ${data.reportType}` };
        }

        const sensitivityLevel = getSensitivityLevel(data.reportType);

        const { encryptedBuffer, keyRef } = await encryptDocument(fileBuffer);
        const reportCID  = await uploadFile(encryptedBuffer);
        const reportHash = crypto.createHash("sha256").update(fileBuffer).digest("hex");

        const result = await getContract("laboratory");
        gateway = result.gateway;
        client  = result.client;
        const { contract } = result;

        const timestamp = new Date().toISOString();

        await contract.submitTransaction(
            "CreateLabReport",
            data.reportID,
            data.patientID,
            data.labTechID,
            data.reportType,
            sensitivityLevel,
            reportCID,
            reportHash,
            keyRef,
            data.status ?? "PENDING",
            timestamp,
            timestamp
        );

        await logAudit({
            actorID:      actorID ?? data.labTechID,
            actorRole:    "doctor",
            action:       "CREATE",
            resourceType: "LAB_REPORT",
            resourceID:   data.patientID,
        });

        // Notify patient
        const patient = await PatientAuth.findOne({ patientID: data.patientID });
        if (patient) {
            await notify({
                recipientID:   data.patientID,
                recipientRole: "patient",
                phone:         patient.phone,
                event:         "LAB_REPORT_UPLOADED",
                message:       NotificationEvents.LAB_REPORT_UPLOADED(data.reportType),
                channel:       "sms",
            });
        }

        return {
            status:           "SUCCESS",
            reportID:         data.reportID,
            reportCID,
            reportHash,
            sensitivityLevel,
            encryptionKeyRef: keyRef,
        };
    } catch (err) {
        await logAudit({
            actorID:      actorID ?? data.labTechID,
            actorRole:    "doctor",
            action:       "ACCESS_FAILED",
            resourceType: "LAB_REPORT",
            resourceID:   data.patientID,
        });
        return { status: "FAILED", message: err.message };
    } finally {
        if (gateway) await gateway.close();
        if (client)  client.close();
    }
}

export async function getLabReport(reportID, actorID, actorRole, orgName = "laboratory") {
    let gateway, client;
    try {
        const result = await getContract(orgName);
        gateway = result.gateway;
        client  = result.client;
        const { contract } = result;

        const raw  = await contract.evaluateTransaction("GetLabReport", reportID);
        const data = JSON.parse(Buffer.from(raw).toString("utf8"));

        if (data.sensitivityLevel === "SENSITIVE") {
            const hasPermission = await hasActivePermission(actorID, reportID);
            if (!hasPermission) {
                await logAudit({ actorID, actorRole, action: "ACCESS_DENIED", resourceType: "LAB_REPORT", resourceID: reportID });
                return { status: "ACCESS_DENIED", message: "This is a sensitive record. Please request patient permission first.", requiresPermission: true, resourceID: reportID, resourceType: "LAB_REPORT" };
            }
        } else {
            const hasRelationship = await hasActiveTreatmentRelationship(actorID, data.patientID);
            if (!hasRelationship) {
                await logAudit({ actorID, actorRole, action: "ACCESS_DENIED", resourceType: "LAB_REPORT", resourceID: reportID });
                return { status: "ACCESS_DENIED", message: "No active treatment relationship with this patient." };
            }
        }

        await logAudit({ actorID, actorRole, action: "READ", resourceType: "LAB_REPORT", resourceID: reportID });

        return { status: "SUCCESS", data };
    } catch (err) {
        return { status: "FAILED", message: err.message };
    } finally {
        if (gateway) await gateway.close();
        if (client)  client.close();
    }
}

export async function getLabReportDocument(reportID, actorID, actorRole, orgName = "laboratory") {
    let gateway, client;
    try {
        const result = await getContract(orgName);
        gateway = result.gateway;
        client  = result.client;
        const { contract } = result;

        const raw = await contract.evaluateTransaction("GetLabReport", reportID);
        const { reportCID, encryptionKeyRef, sensitivityLevel, patientID } = JSON.parse(
            Buffer.from(raw).toString("utf8")
        );

        if (sensitivityLevel === "SENSITIVE") {
            const hasPermission = await hasActivePermission(actorID, reportID);
            if (!hasPermission) {
                await logAudit({ actorID, actorRole, action: "ACCESS_DENIED", resourceType: "LAB_REPORT", resourceID: reportID });
                return { status: "ACCESS_DENIED", message: "This is a sensitive record. Please request patient permission first.", requiresPermission: true, resourceID: reportID, resourceType: "LAB_REPORT" };
            }
        } else {
            const hasRelationship = await hasActiveTreatmentRelationship(actorID, patientID);
            if (!hasRelationship) {
                await logAudit({ actorID, actorRole, action: "ACCESS_DENIED", resourceType: "LAB_REPORT", resourceID: reportID });
                return { status: "ACCESS_DENIED", message: "No active treatment relationship with this patient." };
            }
        }

        const encryptedBuffer = await getFile(reportCID);
        const plaintext       = await decryptDocument(encryptedBuffer, encryptionKeyRef);

        await logAudit({ actorID, actorRole, action: "READ", resourceType: "LAB_REPORT", resourceID: reportID });

        return { status: "SUCCESS", document: plaintext };
    } catch (err) {
        return { status: "FAILED", message: err.message };
    } finally {
        if (gateway) await gateway.close();
        if (client)  client.close();
    }
}

export async function updateLabReport(data, fileBuffer, actorID) {
    let gateway, client;
    try {
        const { encryptedBuffer, keyRef } = await encryptDocument(fileBuffer);
        const reportCID  = await uploadFile(encryptedBuffer);
        const reportHash = crypto.createHash("sha256").update(fileBuffer).digest("hex");

        const sensitivityLevel = getSensitivityLevel(data.reportType);

        const result = await getContract("laboratory");
        gateway = result.gateway;
        client  = result.client;
        const { contract } = result;

        const updatedAt = new Date().toISOString();

        await contract.submitTransaction(
            "UpdateLabReport",
            data.reportID,
            data.reportType,
            reportCID,
            reportHash,
            keyRef,
            data.status ?? "COMPLETED",
            updatedAt
        );

        await logAudit({ actorID, actorRole: "doctor", action: "UPDATE", resourceType: "LAB_REPORT", resourceID: data.reportID });

        return { status: "SUCCESS", reportID: data.reportID, reportCID, reportHash, sensitivityLevel, encryptionKeyRef: keyRef };
    } catch (err) {
        return { status: "FAILED", message: err.message };
    } finally {
        if (gateway) await gateway.close();
        if (client)  client.close();
    }
}

