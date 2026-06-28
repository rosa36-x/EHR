import { getContract } from "./fabricService.js";
import { generateID } from "./idService.js";
import { notify, NotificationEvents } from "./notificationService.js";
import { PatientAuth, Doctor } from "./db.js";

/**
 * Permission Request Service
 *
 * Flow for sensitive record access:
 * 1. Doctor calls createPermissionRequest()
 * 2. Patient gets notified via SMS
 * 3. Patient approves or rejects via approvePermissionRequest() / rejectPermissionRequest()
 * 4. If no response in 24 hours, request auto-expires (checked on access attempt)
 * 5. Approved requests grant 48-hour access window
 */

/**
 * Create a permission request for sensitive record access.
 * Called by doctor when attempting to access a sensitive record.
 */
export async function createPermissionRequest(data) {
    let gateway, client;
    try {
        const requestID = generateID("permissionRequest");
        const now       = new Date();
        const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString(); // 24 hours

        const result = await getContract("hospital");
        gateway = result.gateway;
        client  = result.client;
        const { contract } = result;

        const timestamp = now.toISOString();

        await contract.submitTransaction(
            "CreatePermissionRequest",
            requestID,
            data.patientID,
            data.doctorID,
            data.resourceType,
            data.resourceID,
            data.reason,
            "PENDING",
            expiresAt,
            timestamp,
            timestamp
        );

        // Notify patient
        const patient = await PatientAuth.findOne({ patientID: data.patientID });
        const doctor  = await Doctor.findOne({ doctorID: data.doctorID });

        if (patient && doctor) {
            await notify({
                recipientID:   data.patientID,
                recipientRole: "patient",
                phone:         patient.phone,
                event:         "SENSITIVE_RECORD_ACCESS_REQUEST",
                message:       NotificationEvents.SENSITIVE_RECORD_ACCESS_REQUEST(
                                   doctor.fullName,
                                   data.resourceType
                               ),
                channel: "sms",
            });
        }

        return { status: "SUCCESS", requestID, expiresAt };
    } catch (err) {
        console.error("[PermissionRequest] create failed:", err);
        return { status: "FAILED", message: err.message };
    } finally {
        if (gateway) await gateway.close();
        if (client)  client.close();
    }
}

/**
 * Patient approves a permission request.
 * Grants doctor 48-hour access to the specific record.
 */
export async function approvePermissionRequest(requestID, patientID) {
    let gateway, client;
    try {
        const result = await getContract("hospital");
        gateway = result.gateway;
        client  = result.client;
        const { contract } = result;

        const now           = new Date();
        const accessExpires = new Date(now.getTime() + 48 * 60 * 60 * 1000).toISOString(); // 48 hours
        const updatedAt     = now.toISOString();

        await contract.submitTransaction(
            "ApprovePermissionRequest",
            requestID,
            "APPROVED",
            accessExpires,
            updatedAt
        );

        // Notify doctor
        const raw     = await contract.evaluateTransaction("GetPermissionRequest", requestID);
        const reqData = JSON.parse(Buffer.from(raw).toString("utf8"));
        const doctor  = await Doctor.findOne({ doctorID: reqData.doctorID });
        const patient = await PatientAuth.findOne({ patientID });

        if (doctor) {
            await notify({
                recipientID:   reqData.doctorID,
                recipientRole: "doctor",
                phone:         doctor.phone,
                event:         "PERMISSION_GRANTED",
                message:       NotificationEvents.PERMISSION_GRANTED(
                                   patient?.patientID ?? patientID,
                                   reqData.resourceType
                               ),
                channel: "sms",
            });
        }

        return { status: "SUCCESS", requestID, accessExpires };
    } catch (err) {
        return { status: "FAILED", message: err.message };
    } finally {
        if (gateway) await gateway.close();
        if (client)  client.close();
    }
}

/**
 * Patient rejects a permission request.
 */
export async function rejectPermissionRequest(requestID, patientID) {
    let gateway, client;
    try {
        const result = await getContract("hospital");
        gateway = result.gateway;
        client  = result.client;
        const { contract } = result;

        const updatedAt = new Date().toISOString();

        await contract.submitTransaction(
            "RejectPermissionRequest",
            requestID,
            "REJECTED",
            updatedAt
        );

        // Notify doctor
        const raw     = await contract.evaluateTransaction("GetPermissionRequest", requestID);
        const reqData = JSON.parse(Buffer.from(raw).toString("utf8"));
        const doctor  = await Doctor.findOne({ doctorID: reqData.doctorID });

        if (doctor) {
            await notify({
                recipientID:   reqData.doctorID,
                recipientRole: "doctor",
                phone:         doctor.phone,
                event:         "PERMISSION_REJECTED",
                message:       NotificationEvents.PERMISSION_REJECTED(
                                   patientID,
                                   reqData.resourceType
                               ),
                channel: "sms",
            });
        }

        return { status: "SUCCESS", requestID };
    } catch (err) {
        return { status: "FAILED", message: err.message };
    } finally {
        if (gateway) await gateway.close();
        if (client)  client.close();
    }
}

/**
 * Get a permission request record.
 */
export async function getPermissionRequest(requestID) {
    let gateway, client;
    try {
        const result = await getContract("hospital");
        gateway = result.gateway;
        client  = result.client;
        const { contract } = result;

        const raw  = await contract.evaluateTransaction("GetPermissionRequest", requestID);
        const data = JSON.parse(Buffer.from(raw).toString("utf8"));

        return { status: "SUCCESS", data };
    } catch (err) {
        return { status: "FAILED", message: err.message };
    } finally {
        if (gateway) await gateway.close();
        if (client)  client.close();
    }
}

/**
 * Check if a doctor has active approved access to a specific record.
 * Used as a gate before serving sensitive records.
 *
 * @returns {boolean} hasAccess
 */
export async function hasActivePermission(doctorID, resourceID) {
    let gateway, client;
    try {
        const result = await getContract("hospital");
        gateway = result.gateway;
        client  = result.client;
        const { contract } = result;

        const raw  = await contract.evaluateTransaction(
            "CheckActivePermission",
            doctorID,
            resourceID
        );

        return Buffer.from(raw).toString("utf8") === "true";
    } catch (err) {
        console.error("[PermissionRequest] hasActivePermission failed:", err);
        return false;
    } finally {
        if (gateway) await gateway.close();
        if (client)  client.close();
    }
}
