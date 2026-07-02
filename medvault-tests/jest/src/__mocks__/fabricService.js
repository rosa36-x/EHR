/**
 * __mocks__/fabricService.js
 *
 * fabricService.js in the real backend exports ONE thing: getContract(orgName),
 * which returns { gateway, client, contract } for talking to Hyperledger Fabric.
 * Every *FabricService.js file, auditMiddleware.js, and routes/auditHistory.js
 * call getContract() directly and then use contract.submitTransaction(...) /
 * contract.evaluateTransaction(...) with a chaincode function name as the
 * first argument.
 *
 * This mock fakes that same shape — NOT the domain functions built on top of
 * it — so real business logic (sensitivity checks, permission gating, audit
 * triggering) keeps running for real in tests; only the actual ledger call is
 * stubbed.
 *
 * Default responses below are generic "just succeed" placeholders. Override
 * per test with:
 *   fabricMock.__contract.evaluateTransaction.mockImplementationOnce(...)
 *   fabricMock.__contract.submitTransaction.mockResolvedValueOnce(...)
 */

'use strict';

function defaultEvaluate(fnName, ...args) {
  switch (fnName) {
    case 'CheckActiveTreatmentRelationship':
    case 'CheckActivePermission':
    case 'CheckConsent':
      return Buffer.from('true');

    case 'GetConsultation':
      return Buffer.from(JSON.stringify({
        consultationID:   args[0],
        patientID:        'PAT0001',
        doctorID:         'DOC0001',
        diagnosis:        'Mock diagnosis',
        recordType:       'GENERAL',
        sensitivityLevel: 'NORMAL',
        consultationCID:  'bafymock-default-cid',
        consultationHash: 'mockhash',
        encryptionKeyRef: 'KEY_DEFAULT_0001',
        createdAt:        new Date().toISOString(),
        updatedAt:        new Date().toISOString(),
      }));

    case 'GetPrescription':
      return Buffer.from(JSON.stringify({
        prescriptionID: args[0], patientID: 'PAT0001', doctorID: 'DOC0001',
        sensitivityLevel: 'NORMAL', prescriptionCID: 'bafymock-default-cid',
        encryptionKeyRef: 'KEY_DEFAULT_0001', status: 'ISSUED',
      }));

    case 'GetLabReport':
      return Buffer.from(JSON.stringify({
        reportID: args[0], patientID: 'PAT0001', labTechID: 'DOC0001',
        sensitivityLevel: 'NORMAL', reportCID: 'bafymock-default-cid',
        encryptionKeyRef: 'KEY_DEFAULT_0001', status: 'COMPLETED',
      }));

    case 'GetReferral':
      return Buffer.from(JSON.stringify({
        referralID: args[0], patientID: 'PAT0001', fromDoctorID: 'DOC0001',
        toDoctorID: 'DOC0002', sensitivityLevel: 'NORMAL',
        referralCID: 'bafymock-default-cid', encryptionKeyRef: 'KEY_DEFAULT_0001',
      }));

    case 'GetConsent':
      return Buffer.from(JSON.stringify({
        consentID: args[0], patientID: 'PAT0001', granteeOrg: 'ResearchOrg',
        resourceType: 'CONSULTATION', status: 'ACTIVE',
      }));

    case 'GetPermissionRequest':
      return Buffer.from(JSON.stringify({
        requestID: args[0], status: 'PENDING', doctorID: 'DOC0001',
        patientID: 'PAT0001', resourceType: 'CONSULTATION', resourceID: 'CONS0001',
      }));

    case 'GetTreatmentRelationship':
      return Buffer.from(JSON.stringify({
        relationshipID: args[0], status: 'ACTIVE', doctorID: 'DOC0001', patientID: 'PAT0001',
      }));

    case 'GetEmergencyAccess':
      return Buffer.from(JSON.stringify({
        emergencyAccessID: args[0], patientID: 'PAT0001', doctorID: 'DOC0001',
        reason: 'Mock emergency', status: 'ACTIVE',
      }));

    case 'GetAuditLog':
      return Buffer.from(JSON.stringify({
        auditID: args[0], actorID: 'DOC0001', actorRole: 'doctor', action: 'READ',
        resourceType: 'CONSULTATION', resourceID: 'PAT0001', timestamp: new Date().toISOString(),
      }));

    case 'GetPatient':
      return Buffer.from(JSON.stringify({
        patientID: args[0], fullName: 'Mock Patient', status: 'ACTIVE',
      }));

    default:
      return Buffer.from('{}');
  }
}

const contract = {
  submitTransaction:   jest.fn(async () => Buffer.from('')),
  evaluateTransaction: jest.fn(async (fnName, ...args) => defaultEvaluate(fnName, ...args)),
};

const gateway = { close: jest.fn(async () => {}) };
const client  = { close: jest.fn(() => {}) };

const getContract = jest.fn(async (_orgName = 'hospital') => ({ gateway, client, contract }));

/** Reset call history and restore default dispatcher behavior between tests. */
const __resetAll = () => {
  getContract.mockClear();
  gateway.close.mockClear();
  client.close.mockClear();
  contract.submitTransaction.mockReset();
  contract.submitTransaction.mockImplementation(async () => Buffer.from(''));
  contract.evaluateTransaction.mockReset();
  contract.evaluateTransaction.mockImplementation(async (fnName, ...args) => defaultEvaluate(fnName, ...args));
};

module.exports = {
  getContract,
  __contract: contract,
  __gateway:  gateway,
  __client:   client,
  __resetAll,
};
