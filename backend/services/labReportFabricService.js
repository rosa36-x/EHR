import crypto from "crypto";
import { getContract, mspIdForOrg } from "./fabricService.js";
import { encryptDocument, decryptDocument } from "./kmsService.js";
import { uploadFile, getFile } from "./ipfsService.js";
import { logAudit } from "./auditMiddleware.js";
import { getSensitivityLevel, isValidRecordType } from "./sensitivityService.js";
import { canAccessRecord } from "./accessControlService.js";
import { notify, NotificationEvents } from "./notificationService.js";
import { PatientAuth } from "./db.js";
import { hasActiveTreatmentRelationship } from "./treatmentRelationshipFabricService.js";
import { hasActivePermission } from "./permissionRequestFabricService.js";
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

        const access = await canAccessRecord({
            actorID, actorRole,
            patientID:        data.patientID,
            resourceID:       reportID,
            resourceType:     "LAB_REPORT",
            sensitivityLevel: data.sensitivityLevel,
        });
        if (!access.allowed) {
            return { status: access.status, message: access.message, requiresPermission: access.requiresPermission, resourceID: access.resourceID, resourceType: access.resourceType };
        }

        await logAudit({ actorID, actorRole, action: "READ", resourceType: "LAB_REPORT", resourceID: reportID, actorOrg: mspIdForOrg(orgName) });

        return { status: "SUCCESS", data };
    } catch (err) {
        return { status: "FAILED", message: err.message };
    } finally {
        if (gateway) await gateway.close();
        if (client)  client.close();
    }
}
export async function getLabReportsByPatient(patientID, actorID, actorRole) {
    let gateway, client;
    try {
        const result = await getContract("hospital");
        gateway = result.gateway;
        client  = result.client;
        const { contract } = result;

        const raw = await contract.evaluateTransaction("GetLabReportsByPatient", patientID);
        const all = JSON.parse(Buffer.from(raw).toString("utf8")) ?? [];

        if (actorRole === "patient") {
            if (actorID !== patientID) {
                return { status: "ACCESS_DENIED", message: "Patients can only view their own records." };
            }
            return { status: "SUCCESS", data: all };
        }

        const hasRelationship = await hasActiveTreatmentRelationship(actorID, patientID);
        const visible = [];
        for (const l of all) {
            if (l.sensitivityLevel === "SENSITIVE") {
                if (await hasActivePermission(actorID, l.reportID)) visible.push(l);
            } else if (hasRelationship) {
                visible.push(l);
            }
        }
        return { status: "SUCCESS", data: visible };
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

        const access = await canAccessRecord({
            actorID, actorRole,
            patientID,
            resourceID:       reportID,
            resourceType:     "LAB_REPORT",
            sensitivityLevel,
        });
        if (!access.allowed) {
            return { status: access.status, message: access.message, requiresPermission: access.requiresPermission, resourceID: access.resourceID, resourceType: access.resourceType };
        }

        const encryptedBuffer = await getFile(reportCID);
        const plaintext       = await decryptDocument(encryptedBuffer, encryptionKeyRef);

        await logAudit({ actorID, actorRole, action: "READ", resourceType: "LAB_REPORT", resourceID: reportID, actorOrg: mspIdForOrg(orgName) });

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

