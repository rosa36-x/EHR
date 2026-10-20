import { logAudit } from "./auditMiddleware.js";
import { hasActiveTreatmentRelationship, getTreatmentRelationship } from "./treatmentRelationshipFabricService.js";
import { hasActivePermission } from "./permissionRequestFabricService.js";
import { EmergencyAccessLog } from "./db.js";

/**
 * Break-glass check: does this doctor have an OPEN emergency episode for this
 * patient right now? All of the following must hold:
 *   - an EmergencyAccessLog row for (doctor, patient) that is ACTIVE and not
 *     past its 24h expiry (closeEmergencyAccess() flips it to CLOSED), and
 *   - the backing ASSIGNED_EMERGENCY_PHYSICIAN relationship is still ACTIVE
 *     and unexpired on the ledger (so discharging it through the relationship
 *     routes also ends the override, not just the explicit close).
 * Any error fails CLOSED: no override.
 */
export async function hasActiveEmergencyAccess(doctorID, patientID) {
    try {
        const now = new Date();
        const log = await EmergencyAccessLog.findOne({
            doctorID,
            patientID,
            status:    "ACTIVE",
            expiresAt: { $gt: now.toISOString() },
        });
        if (!log) return false;

        const rel = await getTreatmentRelationship(log.relationshipID, doctorID, "doctor");
        return (
            rel.status === "SUCCESS" &&
            rel.data.relationshipType === "ASSIGNED_EMERGENCY_PHYSICIAN" &&
            rel.data.status === "ACTIVE" &&
            new Date(rel.data.dormantAfter) > now
        );
    } catch (err) {
        console.error("[AccessControl] emergency access check failed, denying override:", err.message);
        return false;
    }
}

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
 *      Exception (break-glass): a doctor with an open emergency episode for
 *      this patient (hasActiveEmergencyAccess) may read SENSITIVE records
 *      without a permission request, for the life of that episode only. The
 *      override is written to the audit log as EMERGENCY_OVERRIDE.
 *   3. Non-sensitive records require an active treatment relationship.
 *      Emergency access satisfies this because createEmergencyAccess()
 *      grants an ASSIGNED_EMERGENCY_PHYSICIAN treatment relationship —
 *      there's no separate emergency check needed here.
 *
 * Consent-based cross-org access (e.g. a pharmacist reading a prescription
 * under patient consent to PharmacyMSP):
 *   This is now step 0, ahead of the patient/sensitivity/treatment-relationship
 *   checks below, and it does NOT re-run the consent check in JS. By the time
 *   canAccessRecord() is called, prescriptionFabricService/labReportFabricService
 *   have already called contract.evaluateTransaction("GetPrescription"/"GetLabReport"),
 *   and chaincode/prescription_contract.go's GetPrescription already ran
 *   HasActiveConsent() against the caller's own MSP identity for any non-Hospital
 *   org — if that check had failed, evaluateTransaction would have thrown before
 *   we ever got here. Re-implementing the same consent lookup in JS would just
 *   be two copies of the same rule that can drift apart; trusting the ledger
 *   read is the correct source of truth here.
 *   Org-level consent (Consent.granteeOrg) also means this is deliberately NOT
 *   gated by sensitivityLevel/hasActivePermission — a patient consenting to
 *   PharmacyMSP for PRESCRIPTION is already a more specific, patient-approved
 *   grant than the doctor-facing permission-request flow below.
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
    // 0. Cross-org actors (pharmacist, lab-tech) — consent already checked
    //    on-chain inside GetPrescription/GetLabReport before this function
    //    is ever called. See docstring above for why this doesn't re-check.
    if (actorRole === "org_actor") {
        return { allowed: true };
    }

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
            if (await hasActiveEmergencyAccess(actorID, patientID)) {
                await logAudit({ actorID, actorRole, action: "EMERGENCY_OVERRIDE", resourceType, resourceID });
                return { allowed: true, emergencyOverride: true };
            }
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
