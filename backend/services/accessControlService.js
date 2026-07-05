import { logAudit } from "./auditMiddleware.js";
import { hasActiveTreatmentRelationship } from "./treatmentRelationshipFabricService.js";
import { hasActivePermission } from "./permissionRequestFabricService.js";

/**
 * Access Control Service
 *
 * Single reusable gate for "can this doctor read this patient's record?"
 * Replaces the sensitivity/treatment-relationship check that was previously
 * duplicated across consultationFabricService, prescriptionFabricService,
 * labReportFabricService, and referralFabricService.
 *
 * Current decision order:
 *   1. Patients may only access their own records.
 *   2. SENSITIVE records require an explicit, patient-approved permission
 *      request (hasActivePermission) — regardless of treatment relationship.
 *   3. Non-sensitive records require an active treatment relationship.
 *      Emergency access satisfies this because createEmergencyAccess()
 *      grants an ASSIGNED_EMERGENCY_PHYSICIAN treatment relationship —
 *      there's no separate emergency check needed here.
 *
 * NOT YET IMPLEMENTED — consent-based cross-org access:
 *   The intended fuller flow also wants a branch for cross-org access
 *   (e.g. a pharmacist reading a prescription under patient consent to
 *   PharmacyMSP) that doesn't depend on a treatment relationship at all.
 *   Two things are missing before that branch can be added here:
 *     a) An actor-org concept — today every Doctor record only has a
 *        hospitalID (which specific hospital), not an MSP/org category,
 *        and there is no pharmacist/lab-tech account type in the auth
 *        model at all (see backend/services/db.js — all doctors share the
 *        HospitalMSP Fabric identity).
 *     b) A chaincode query to look up "does patientID have ACTIVE consent
 *        granted to org X for resourceType Y?" — chaincode/consent_contract.go
 *        currently only supports fetching one consent by a known consentID
 *        (GetConsent/CheckConsent), not a lookup by patient+org+type. This
 *        needs a new chaincode function (e.g. a composite-key index or
 *        CouchDB rich query) and a chaincode lifecycle upgrade — out of
 *        scope for an application-layer patch.
 *   Once both exist, add a step 4 here: if steps 2/3 fail and the actor's
 *   org differs from the record's owning org, call the new consent-lookup
 *   function and allow if it returns an active grant.
 *
 * @param {object} params
 * @param {string} params.actorID        - doctorID or patientID making the request
 * @param {string} params.actorRole      - "doctor" | "patient"
 * @param {string} params.patientID      - patient who owns the record
 * @param {string} params.resourceID     - the specific record ID (for audit logging)
 * @param {string} params.resourceType   - e.g. "CONSULTATION", "PRESCRIPTION"
 * @param {string} params.sensitivityLevel - "SENSITIVE" | "NORMAL" (or undefined)
 * @returns {Promise<{allowed: boolean, status: string, message?: string, requiresPermission?: boolean}>}
 */
export async function canAccessRecord({
    actorID,
    actorRole,
    patientID,
    resourceID,
    resourceType,
    sensitivityLevel,
}) {
    // 1. Patients may only access their own records.
    if (actorRole === "patient") {
        if (actorID === patientID) {
            return { allowed: true };
        }
        await logAudit({ actorID, actorRole, action: "ACCESS_DENIED", resourceType, resourceID });
        return {
            allowed: false,
            status:  "ACCESS_DENIED",
            message: "Patients can only view their own records.",
        };
    }

    // 2. Sensitive records require explicit, patient-approved permission —
    //    a treatment relationship alone is not enough.
    if (sensitivityLevel === "SENSITIVE") {
        const hasPermission = await hasActivePermission(actorID, resourceID);
        if (!hasPermission) {
            await logAudit({ actorID, actorRole, action: "ACCESS_DENIED", resourceType, resourceID });
            return {
                allowed: false,
                status:  "ACCESS_DENIED",
                message: "This is a sensitive record. Please request patient permission first.",
                requiresPermission: true,
                resourceID,
                resourceType,
            };
        }
        return { allowed: true };
    }

    // 3. Normal records require an active treatment relationship.
    //    (Emergency access satisfies this via its ASSIGNED_EMERGENCY_PHYSICIAN
    //    relationship — see emergencyFabricService.createEmergencyAccess.)
    const hasRelationship = await hasActiveTreatmentRelationship(actorID, patientID);
    if (!hasRelationship) {
        await logAudit({ actorID, actorRole, action: "ACCESS_DENIED", resourceType, resourceID });
        return {
            allowed: false,
            status:  "ACCESS_DENIED",
            message: "No active treatment relationship with this patient.",
        };
    }

    return { allowed: true };
}
