'use strict';

const { WorkloadModuleBase } = require('@hyperledger/caliper-core');

/**
 * Write workload: CreateConsultation(...) -- writes into the Hospital PDC.
 * Args match chaincode/consultation_contract.go's exact signature:
 *   consultationID, patientID, doctorID, diagnosis, recordType,
 *   sensitivityLevel, consultationCID, consultationHash, encryptionKeyRef,
 *   timestamp, createdAt, updatedAt
 *
 * NOTE: depending on how policy.EnforcePolicy("CREATE_CONSULTATION") is
 * defined, this may require an active TreatmentRelationship to already
 * exist for (doctorID, patientID) -- if so, run
 * createTreatmentRelationship.js first (or a fixed setup phase) so this
 * workload doesn't fail on the precondition rather than measure real
 * write throughput. Check chaincode/policy/policy_registry.go if this
 * workload only returns errors.
 */
class CreateConsultationWorkload extends WorkloadModuleBase {
    constructor() {
        super();
        this.txIndex = 0;
    }

    async submitTransaction() {
        this.txIndex++;
        const consultationID = `CALIPER-CONS-${this.workerIndex}-${this.txIndex}-${Date.now()}`;
        const patientID = `patient-${(this.workerIndex + this.txIndex) % 100}`;
        const doctorID = `doctor-${this.workerIndex % 5}`;
        const now = new Date().toISOString();

        await this.sutAdapter.sendRequests({
            contractId: 'medvault',
            contractFunction: 'CreateConsultation',
            contractArguments: [
                consultationID,
                patientID,
                doctorID,
                'Caliper benchmark diagnosis placeholder',
                'CONSULTATION',
                'NORMAL',
                'bafybeicaliperplaceholdercidxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
                'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b85',
                'kms-key-caliper-benchmark',
                now,
                now,
                now,
            ],
            invokerIdentity: 'hospitalAdmin',
            readOnly: false,
        });
    }
}

function createWorkloadModule() {
    return new CreateConsultationWorkload();
}

module.exports.createWorkloadModule = createWorkloadModule;
