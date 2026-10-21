import crypto from "crypto";
import { getContract, mspIdForOrg } from "./fabricService.js";
import { encryptDocument, decryptDocument } from "./kmsService.js";
import { uploadFile, getFile } from "./ipfsService.js";
import { logAudit } from "./auditMiddleware.js";
import { getSensitivityLevel, isValidRecordType } from "./sensitivityService.js";
import { canAccessRecord, hasActiveEmergencyAccess } from "./accessControlService.js";
import { notify, NotificationEvents } from "./notificationService.js";
import { PatientAuth, Doctor } from "./db.js";
import { hasActiveTreatmentRelationship } from "./treatmentRelationshipFabricService.js";
import { hasActivePermission } from "./permissionRequestFabricService.js";

export async function createPrescription(data, fileBuffer, actorID, actorRole = "doctor", actorOrg = "HospitalMSP") {
    let gateway, client;
    try {
        if (!isValidRecordType("PRESCRIPTION", data.recordType)) {
            return { status: "FAILED", message: `Invalid recordType: ${data.recordType}` };
        }

        const sensitivityLevel = getSensitivityLevel(data.recordType);

        const { encryptedBuffer, keyRef } = await encryptDocument(fileBuffer);
        const prescriptionCID  = await uploadFile(encryptedBuffer);
        const prescriptionHash = crypto.createHash("sha256").update(fileBuffer).digest("hex");

        const result = await getContract("hospital");
        gateway = result.gateway;
        client  = result.client;
        const { contract } = result;

        const timestamp = new Date().toISOString();

        await contract.submitTransaction(
            "CreatePrescription",
            data.prescriptionID,
            data.patientID,
            data.doctorID,
            data.recordType,
            sensitivityLevel,
            prescriptionCID,
            prescriptionHash,
            keyRef,
            data.status ?? "ISSUED",
            data.issuedAt ?? timestamp,
            data.dispensedAt ?? "",
            timestamp,
            timestamp
        );

        await logAudit({
            actorID:      actorID ?? data.doctorID,
            actorRole,
            actorOrg,
            action:       "CREATE",
            resourceType: "PRESCRIPTION",
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
                message:       NotificationEvents.RECORD_ACCESSED("prescription", doctor.fullName),
                channel:       "sms",
            });
        }

        return {
            status:           "SUCCESS",
            prescriptionID:   data.prescriptionID,
            prescriptionCID,
            prescriptionHash,
            sensitivityLevel,
            encryptionKeyRef: keyRef,
        };
    } catch (err) {
        await logAudit({
            actorID:      actorID ?? data.doctorID,
            actorRole,
            actorOrg,
            action:       "ACCESS_FAILED",
            resourceType: "PRESCRIPTION",
            resourceID:   data.patientID,
        });
        return { status: "FAILED", message: err.message };
    } finally {
        if (gateway) await gateway.close();
        if (client)  client.close();
    }
}

export async function getPrescription(prescriptionID, actorID, actorRole, orgName = "hospital") {
    let gateway, client;
    try {
        const result = await getContract(orgName);
        gateway = result.gateway;
        client  = result.client;
        const { contract } = result;

        const raw  = await contract.evaluateTransaction("GetPrescription", prescriptionID);
        const data = JSON.parse(Buffer.from(raw).toString("utf8"));

        const access = await canAccessRecord({
            actorID, actorRole,
            patientID:        data.patientID,
            resourceID:       prescriptionID,
            resourceType:     "PRESCRIPTION",
            sensitivityLevel: data.sensitivityLevel,
        });
        if (!access.allowed) {
            return { status: access.status, message: access.message, requiresPermission: access.requiresPermission, resourceID: access.resourceID, resourceType: access.resourceType };
        }

        await logAudit({ actorID, actorRole, action: "READ", resourceType: "PRESCRIPTION", resourceID: prescriptionID, actorOrg: mspIdForOrg(orgName) });

        return { status: "SUCCESS", data };
    } catch (err) {
        if (err.message?.includes("CONSENT_REQUIRED")) {
            await logAudit({ actorID, actorRole, action: "ACCESS_DENIED", resourceType: "PRESCRIPTION", resourceID: prescriptionID, actorOrg: mspIdForOrg(orgName) });
            return { status: "ACCESS_DENIED", message: "No active consent for cross-org access to this prescription." };
        }
        return { status: "FAILED", message: err.message };
    } finally {
        if (gateway) await gateway.close();
        if (client)  client.close();
    }
}
export async function getPrescriptionsByPatient(patientID, actorID, actorRole) {
    let gateway, client;
    try {
        const result = await getContract("hospital");
        gateway = result.gateway;
        client  = result.client;
        const { contract } = result;

        const raw = await contract.evaluateTransaction("GetPrescriptionsByPatient", patientID);
        const text = Buffer.from(raw).toString("utf8");
        const all = text ? JSON.parse(text) : [];

        if (actorRole === "patient") {
            if (actorID !== patientID) {
                return { status: "ACCESS_DENIED", message: "Patients can only view their own records." };
            }
            return { status: "SUCCESS", data: all };
        }

        const hasRelationship = await hasActiveTreatmentRelationship(actorID, patientID);
        const visible = [];
        // Break-glass: looked up at most once per list, and only if a
        // sensitive item is actually present.
        let emergency;
        for (const p of all) {
            if (p.sensitivityLevel === "SENSITIVE") {
                if (await hasActivePermission(actorID, p.prescriptionID)) {
                    visible.push(p);
                    continue;
                }
                if (emergency === undefined) emergency = await hasActiveEmergencyAccess(actorID, patientID);
                if (emergency) visible.push(p);
            } else if (hasRelationship) {
                visible.push(p);
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
export async function getPrescriptionDocument(prescriptionID, actorID, actorRole, orgName = "hospital") {
    let gateway, client;
    try {
        const result = await getContract(orgName);
        gateway = result.gateway;
        client  = result.client;
        const { contract } = result;

        const raw = await contract.evaluateTransaction("GetPrescription", prescriptionID);
        const { prescriptionCID, encryptionKeyRef, sensitivityLevel, patientID } = JSON.parse(
            Buffer.from(raw).toString("utf8")
        );

        const access = await canAccessRecord({
            actorID, actorRole,
            patientID,
            resourceID:       prescriptionID,
            resourceType:     "PRESCRIPTION",
            sensitivityLevel,
        });
        if (!access.allowed) {
            return { status: access.status, message: access.message, requiresPermission: access.requiresPermission, resourceID: access.resourceID, resourceType: access.resourceType };
        }

        const encryptedBuffer = await getFile(prescriptionCID);
        const plaintext       = await decryptDocument(encryptedBuffer, encryptionKeyRef, { actorID, actorRole, resourceID: prescriptionID });

        await logAudit({ actorID, actorRole, action: "READ", resourceType: "PRESCRIPTION", resourceID: prescriptionID, actorOrg: mspIdForOrg(orgName) });

        return { status: "SUCCESS", document: plaintext };
    } catch (err) {
        if (err.message?.includes("CONSENT_REQUIRED")) {
            await logAudit({ actorID, actorRole, action: "ACCESS_DENIED", resourceType: "PRESCRIPTION", resourceID: prescriptionID, actorOrg: mspIdForOrg(orgName) });
            return { status: "ACCESS_DENIED", message: "No active consent for cross-org access to this prescription." };
        }
        return { status: "FAILED", message: err.message };
    } finally {
        if (gateway) await gateway.close();
        if (client)  client.close();
    }
}

export async function updatePrescriptionStatus(prescriptionID, status, dispensedAt, actorID, actorRole, orgName = "hospital") {
    let gateway, client;
    try {
        const result = await getContract(orgName);
        gateway = result.gateway;
        client  = result.client;
        const { contract } = result;

        const updatedAt = new Date().toISOString();

        await contract.submitTransaction(
            "UpdatePrescriptionStatus",
            prescriptionID,
            status,
            dispensedAt ?? "",
            updatedAt
        );

        await logAudit({ actorID, actorRole, action: "UPDATE", resourceType: "PRESCRIPTION", resourceID: prescriptionID, actorOrg: mspIdForOrg(orgName) });

        // Notify patient on dispense
        if (status === "DISPENSED") {
            const raw     = await contract.evaluateTransaction("GetPrescription", prescriptionID);
            const presData = JSON.parse(Buffer.from(raw).toString("utf8"));
            const patient = await PatientAuth.findOne({ patientID: presData.patientID });
            if (patient) {
                await notify({
                    recipientID:   presData.patientID,
                    recipientRole: "patient",
                    phone:         patient.phone,
                    event:         "PRESCRIPTION_DISPENSED",
                    message:       NotificationEvents.PRESCRIPTION_DISPENSED(prescriptionID),
                    channel:       "sms",
                });
            }
        }

        return { status: "SUCCESS", prescriptionID };
    } catch (err) {
        if (err.message?.includes("CONSENT_REQUIRED")) {
            await logAudit({ actorID, actorRole, action: "ACCESS_DENIED", resourceType: "PRESCRIPTION", resourceID: prescriptionID, actorOrg: mspIdForOrg(orgName) });
            return { status: "ACCESS_DENIED", message: "No active consent for cross-org access to this prescription." };
        }
        return { status: "FAILED", message: err.message };
    } finally {
        if (gateway) await gateway.close();
        if (client)  client.close();
    }
}
