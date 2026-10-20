'use strict';

const { WorkloadModuleBase } = require('@hyperledger/caliper-core');

/**
 * Write workload: CreateTreatmentRelationship(...)
 * Args match the exact signature in
 * chaincode/treatment_relationship_contract.go (verified against source,
 * not guessed):
 *   relationshipID, patientID, doctorID, relationshipType, notes,
 *   status, dormantAfter, createdAt, updatedAt
 */
class CreateTreatmentRelationshipWorkload extends WorkloadModuleBase {
    constructor() {
        super();
        this.txIndex = 0;
    }

    async submitTransaction() {
        this.txIndex++;
        const relationshipID = `CALIPER-TR-${this.workerIndex}-${this.txIndex}-${Date.now()}`;
        const patientID = `patient-${(this.workerIndex + this.txIndex) % 100}`;
        const doctorID = `doctor-${this.workerIndex % 5}`;
        const now = new Date().toISOString();

        await this.sutAdapter.sendRequests({
            contractId: 'medvault',
            contractFunction: 'CreateTreatmentRelationship',
            contractArguments: [
                relationshipID,
                patientID,
                doctorID,
                'ONGOING_CARE',
                'Caliper benchmark transaction',
                'PENDING',
                new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(), // dormantAfter: +30d
                now,
                now,
            ],
            invokerIdentity: 'hospitalAdmin',
            readOnly: false,
        });
    }
}

function createWorkloadModule() {
    return new CreateTreatmentRelationshipWorkload();
}

module.exports.createWorkloadModule = createWorkloadModule;
