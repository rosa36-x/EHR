import { getContract } from "./fabricService.js";
import { logAudit } from "./auditMiddleware.js";
import { notify, NotificationEvents } from "./notificationService.js";
import { PatientAuth } from "./db.js";

export async function grantConsent(data, actorID) {
    let gateway, client;
    try {
        const result = await getContract("hospital");
        gateway = result.gateway;
        client  = result.client;
        const { contract } = result;

        const timestamp = new Date().toISOString();

        await contract.submitTransaction(
            "GrantConsent",
            data.consentID,
            data.patientID,
            data.granteeOrg,
            data.resourceType,
            data.permission,
            data.status ?? "ACTIVE",
            data.expiryDate ?? "",
            timestamp,
            timestamp
        );

        await logAudit({
            actorID:      actorID ?? data.patientID,
            actorRole:    "patient",
            action:       "CREATE",
            resourceType: "CONSENT",
            resourceID:   data.consentID,
        });

        const patient = await PatientAuth.findOne({ patientID: data.patientID });
        if (patient) {
            await notify({
                recipientID:   data.patientID,
                recipientRole: "patient",
                phone:         patient.phone,
                event:         "CONSENT_GRANTED",
                message:       NotificationEvents.CONSENT_GRANTED(data.granteeOrg, data.resourceType),
                channel:       "sms",
            });
        }

        return { status: "SUCCESS", consentID: data.consentID };
    } catch (err) {
        return { status: "FAILED", message: err.message };
    } finally {
        if (gateway) await gateway.close();
        if (client)  client.close();
    }
}

export async function getConsent(consentID, actorID, actorRole) {
    let gateway, client;
    try {
        const result = await getContract("hospital");
        gateway = result.gateway;
        client  = result.client;
        const { contract } = result;

        const raw  = await contract.evaluateTransaction("GetConsent", consentID);
        const data = JSON.parse(Buffer.from(raw).toString("utf8"));

        await logAudit({ actorID, actorRole, action: "READ", resourceType: "CONSENT", resourceID: consentID });

        return { status: "SUCCESS", data };
    } catch (err) {
        return { status: "FAILED", message: err.message };
    } finally {
        if (gateway) await gateway.close();
        if (client)  client.close();
    }
}

export async function checkConsent(consentID, actorID, actorRole) {
    let gateway, client;
    try {
        const result = await getContract("hospital");
        gateway = result.gateway;
        client  = result.client;
        const { contract } = result;

        const raw    = await contract.evaluateTransaction("CheckConsent", consentID);
        const active = Buffer.from(raw).toString("utf8") === "true";

        await logAudit({ actorID, actorRole, action: "READ", resourceType: "CONSENT", resourceID: consentID });

        return { status: "SUCCESS", isActive: active };
    } catch (err) {
        return { status: "FAILED", message: err.message };
    } finally {
        if (gateway) await gateway.close();
        if (client)  client.close();
    }
}

export async function revokeConsent(consentID, actorID) {
    let gateway, client;
    try {
        const result = await getContract("hospital");
        gateway = result.gateway;
        client  = result.client;
        const { contract } = result;

        const updatedAt = new Date().toISOString();

        // Get consent data before revoking for notification
        const raw      = await contract.evaluateTransaction("GetConsent", consentID);
        const consentData = JSON.parse(Buffer.from(raw).toString("utf8"));

        await contract.submitTransaction("RevokeConsent", consentID, updatedAt);

        await logAudit({ actorID, actorRole: "patient", action: "UPDATE", resourceType: "CONSENT", resourceID: consentID });

        const patient = await PatientAuth.findOne({ patientID: consentData.patientID });
        if (patient) {
            await notify({
                recipientID:   consentData.patientID,
                recipientRole: "patient",
                phone:         patient.phone,
                event:         "CONSENT_REVOKED",
                message:       NotificationEvents.CONSENT_REVOKED(consentData.granteeOrg, consentData.resourceType),
                channel:       "sms",
            });
        }

        return { status: "SUCCESS", consentID };
    } catch (err) {
        return { status: "FAILED", message: err.message };
    } finally {
        if (gateway) await gateway.close();
        if (client)  client.close();
    }
}
