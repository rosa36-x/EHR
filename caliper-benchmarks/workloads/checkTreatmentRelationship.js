'use strict';

const { WorkloadModuleBase } = require('@hyperledger/caliper-core');

/**
 * Read-heavy workload: CheckActiveTreatmentRelationship(doctorID, patientID)
 * Exercises the same evaluateTransaction path
 * treatmentRelationshipFabricService.js's hasActiveTreatmentRelationship()
 * already uses in production. No state changes.
 */
class CheckTreatmentRelationshipWorkload extends WorkloadModuleBase {
    constructor() {
        super();
    }

    async submitTransaction() {
        // Reuse a small fixed pool so repeated reads hit real (or
        // consistently missing) index keys rather than random misses.
        const doctorID = `doctor-${this.workerIndex % 5}`;
        const patientID = `patient-${this.workerIndex % 20}`;

        await this.sutAdapter.sendRequests({
            contractId: 'medvault',
            contractFunction: 'CheckActiveTreatmentRelationship',
            contractArguments: [doctorID, patientID],
            invokerIdentity: 'hospitalAdmin',
            readOnly: true,
        });
    }
}

function createWorkloadModule() {
    return new CheckTreatmentRelationshipWorkload();
}

module.exports.createWorkloadModule = createWorkloadModule;
