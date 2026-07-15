'use strict';

const { WorkloadModuleBase } = require('@hyperledger/caliper-core');

/**
 * Write workload: CreatePrescription(...). Verified directly against
 * chaincode/prescription_contract.go's exact signature:
 *   prescriptionID, patientID, doctorID, recordType, sensitivityLevel,
 *   prescriptionCID, prescriptionHash, encryptionKeyRef, status,
 *   issuedAt, dispensedAt, createdAt, updatedAt
 *
 * Policy: CREATE_PRESCRIPTION restricted to HospitalMSP (verified in
 * chaincode/policy/policy_registry.go) -- hospitalAdmin identity is valid,
 * same as createConsultation.js. No enum/format validation on
 * recordType/sensitivityLevel/status in the chaincode body, so any
 * reasonable placeholder values work.
 */
class CreatePrescriptionWorkload extends WorkloadModuleBase {
    constructor() {
        super();
        this.txIndex = 0;
    }

    async submitTransaction() {
        this.txIndex++;
        const prescriptionID = `CALIPER-PRE-${this.workerIndex}-${this.txIndex}-${Date.now()}`;
        const patientID = `patient-${(this.workerIndex + this.txIndex) % 100}`;
        const doctorID = `doctor-${this.workerIndex % 5}`;
        const now = new Date().toISOString();

        await this.sutAdapter.sendRequests({
            contractId: 'medvault',
            contractFunction: 'CreatePrescription',
            contractArguments: [
                prescriptionID,
                patientID,
                doctorID,
                'PRESCRIPTION',
                'NORMAL',
                'bafybeicaliperplaceholdercidxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
                'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b85',
                'kms-key-caliper-benchmark',
                'ISSUED',
                now,
                '',
                now,
                now,
            ],
            invokerIdentity: 'hospitalAdmin',
            readOnly: false,
        });
    }
}

function createWorkloadModule() {
    return new CreatePrescriptionWorkload();
}

module.exports.createWorkloadModule = createWorkloadModule;
