import { getContract } from "./fabricService.js";
import { logAudit } from "./auditMiddleware.js";
import { notify, NotificationEvents } from "./notificationService.js";
import { PatientAuth } from "./db.js";

export async function grantConsent(data, actorID) {
    let gateway, client;
    try {
        // Defense in depth — consent.js already checks req.body.patientID
        // against req.user.id before calling this, but a patient must never
        // be able to grant consent on another patient's behalf even if some
        // future caller skips that route-level check.
        if (data.patientID !== actorID) {
            await logAudit({ actorID, actorRole: "patient", action: "ACCESS_DENIED", resourceType: "CONSENT", resourceID: data.consentID });
            return { status: "ACCESS_DENIED", message: "Cannot grant consent on behalf of another patient." };
        }

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
        console.error("[grantConsent] error:", err.message, err.details ?? err.cause ?? "");
        return { status: "FAILED", message: err.message };
    } finally {
        if (gateway) await gateway.close();
        if (client)  client.close();
    }
}

// Only the owning patient may read/check/revoke a consent record today.
// Cross-org reads (e.g. a pharmacist checking consent under PharmacyMSP) are
// explicitly not implemented yet — see accessControlService.js docstring —
// so any non-owner, including doctors, is denied for now rather than left
// unchecked. Widen this once the consent-lookup-by-org chaincode query exists.
function assertOwnsConsent(data, actorID, actorRole) {
    if (actorRole === "patient" && data.patientID === actorID) {
        return null;
    }
    return { status: "ACCESS_DENIED", message: "You do not have permission to access this consent record." };
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

        const denied = assertOwnsConsent(data, actorID, actorRole);
        if (denied) {
            await logAudit({ actorID, actorRole, action: "ACCESS_DENIED", resourceType: "CONSENT", resourceID: consentID });
            return denied;
        }

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

        const raw  = await contract.evaluateTransaction("GetConsent", consentID);
        const data = JSON.parse(Buffer.from(raw).toString("utf8"));

        const denied = assertOwnsConsent(data, actorID, actorRole);
        if (denied) {
            await logAudit({ actorID, actorRole, action: "ACCESS_DENIED", resourceType: "CONSENT", resourceID: consentID });
            return denied;
        }

        const activeRaw = await contract.evaluateTransaction("CheckConsent", consentID);
        const active    = Buffer.from(activeRaw).toString("utf8") === "true";

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

        const denied = assertOwnsConsent(consentData, actorID, "patient");
        if (denied) {
            await logAudit({ actorID, actorRole: "patient", action: "ACCESS_DENIED", resourceType: "CONSENT", resourceID: consentID });
            return denied;
        }

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
export async function getConsentsByPatient(patientID, actorID, actorRole) {
    let gateway, client;
    try {
        const result = await getContract("hospital");
        gateway = result.gateway;
        client  = result.client;
        const { contract } = result;
        const raw = await contract.evaluateTransaction("GetConsentsByPatient", patientID);
        const rawStr = Buffer.from(raw).toString("utf8");
        return { status: "SUCCESS", data: rawStr ? JSON.parse(rawStr) : [] };
    } catch (err) {
        return { status: "FAILED", message: err.message };
    } finally {
        if (gateway) await gateway.close();
        if (client)  client.close();
    }
}