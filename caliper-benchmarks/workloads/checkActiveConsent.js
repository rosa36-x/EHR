'use strict';

const { WorkloadModuleBase } = require('@hyperledger/caliper-core');

/**
 * Cross-org consent read: HasActiveConsent(patientID, granteeOrg,
 * resourceType). Verified directly against
 * chaincode/consent_contract.go -- this is a GetPrivateData read against
 * PharmacyMSP's OWN consent-flag PDC (never HospitalMSP's ConsentCollection,
 * which Pharmacy has no read access to at all -- see the function's doc
 * comment in the chaincode). This is the benchmark that demonstrates your
 * headline architectural claim: cross-org, consent-gated PDC access with
 * minimal flag exposure, and that it performs acceptably.
 *
 * Policy: CHECK_ACTIVE_CONSENT allows HospitalMSP, PharmacyMSP,
 * LaboratoryMSP, GovernanceMSP, ResearchMSP (verified in
 * chaincode/policy/policy_registry.go) -- pharmacyAdmin identity is valid.
 */
class CheckActiveConsentWorkload extends WorkloadModuleBase {
    constructor() {
        super();
    }

    async submitTransaction() {
        const patientID = `patient-${this.workerIndex % 20}`;
        const granteeOrg = 'PharmacyMSP';
        const resourceType = 'PRESCRIPTION';

        await this.sutAdapter.sendRequests({
            contractId: 'medvault',
            contractFunction: 'HasActiveConsent',
            contractArguments: [patientID, granteeOrg, resourceType],
            invokerIdentity: '_PharmacyMSP_pharmacyAdmin',
            readOnly: true,
        });
    }
}

function createWorkloadModule() {
    return new CheckActiveConsentWorkload();
}

module.exports.createWorkloadModule = createWorkloadModule;