/**
 * integration/auditMiddleware.test.js
 *
 * Verifies that auditMiddleware auto-generates an audit log entry
 * on every record access, without requiring the route handler to
 * explicitly call createAuditLog.
 *
 * This test intentionally leaves consultationFabricService,
 * treatmentRelationshipFabricService, permissionRequestFabricService,
 * and auditMiddleware UNMOCKED - their real logic must run so we can
 * verify logAudit is actually triggered. Only fabricService (the raw
 * Fabric gateway boundary), ipfsService, kmsService, and
 * notificationService are mocked.
 *
 * Tests:
 *   1. Reading a consultation generates an audit log entry with correct fields
 *   2. A genuine Fabric-layer failure does NOT generate an audit entry
 *      (the real code's catch block returns before reaching logAudit)
 *   3. Audit entry actorID matches the JWT subject
 *   4. Audit entry action is READ for GET requests
 *   5. Unauthenticated requests never reach the route, so no audit entry
 */

'use strict';

jest.mock('../../../../backend/services/fabricService',       () => require('../__mocks__/fabricService'));
jest.mock('../../../../backend/services/ipfsService',         () => require('../__mocks__/ipfsService'));
jest.mock('../../../../backend/services/kmsService',          () => require('../__mocks__/kmsService'));
jest.mock('../../../../backend/services/notificationService', () => require('../__mocks__/notificationService'));

const supertest     = require('supertest');
const app           = require('../../../../backend/server');
const { makeToken } = require('../helpers');
const fabricMock     = require('../../../../backend/services/fabricService');

process.env.MONGODB_URI = process.env.MONGODB_URI_TEST || 'mongodb://localhost:27017/medvault_test';

const DOCTOR_ID  = 'DOC_AUDIT_001';
const PATIENT_ID = 'PAT_AUDIT_001';
const doctorToken = makeToken('doctor', DOCTOR_ID);

// Pull out only the CreateAuditLog calls from the shared submitTransaction mock -
// that jest.fn() receives every chaincode submission (CreateConsultation,
// CreateAuditLog, etc.), so filter by chaincode function name.
function auditLogCalls() {
  return fabricMock.__contract.submitTransaction.mock.calls.filter(
    ([fnName]) => fnName === 'CreateAuditLog'
  );
}

beforeAll(() => {
  fabricMock.__contract.evaluateTransaction.mockImplementation(async (fnName) => {
    if (fnName === 'GetConsultation') {
      return Buffer.from(JSON.stringify({
        consultationID:   'CONS_AUDIT_001',
        patientID:        PATIENT_ID,
        sensitivityLevel: 'NORMAL',
        consultationCID:  'bafymock-audit-cid',
        encryptionKeyRef: 'KEY_AUDIT_001',
      }));
    }
    if (fnName === 'CheckActiveTreatmentRelationship') {
      return Buffer.from('true');
    }
    return Buffer.from('{}');
  });
});

beforeEach(() => {
  fabricMock.__contract.submitTransaction.mockClear();
});

describe('auditMiddleware - auto-generated audit logs', () => {
  test('GET /consultations/:id -> createAuditLog called once', async () => {
    const res = await supertest(app)
      .get('/consultations/CONS_AUDIT_001')
      .set('Authorization', `Bearer ${doctorToken}`);

    expect(res.status).toBe(200);
    expect(auditLogCalls()).toHaveLength(1);
  });

  test('audit log actorID matches doctor token subject', async () => {
    await supertest(app)
      .get('/consultations/CONS_AUDIT_001')
      .set('Authorization', `Bearer ${doctorToken}`);

    // submitTransaction("CreateAuditLog", auditID, actorID, actorRole, action, resourceType, resourceID, timestamp)
    const [, , actorID, actorRole] = auditLogCalls()[0];
    expect(actorID).toBe(DOCTOR_ID);
    expect(actorRole).toBe('doctor');
  });

  test('audit log action is READ for GET request', async () => {
    await supertest(app)
      .get('/consultations/CONS_AUDIT_001')
      .set('Authorization', `Bearer ${doctorToken}`);

    const [, , , , action] = auditLogCalls()[0];
    expect(action).toBe('READ');
  });

  test('audit log resourceType and resourceID are correct', async () => {
    await supertest(app)
      .get('/consultations/CONS_AUDIT_001')
      .set('Authorization', `Bearer ${doctorToken}`);

    const [, , , , , resourceType, resourceID] = auditLogCalls()[0];
    expect(resourceType).toMatch(/CONSULTATION/i);
    expect(resourceID).toBe('CONS_AUDIT_001');
  });

  test('Fabric evaluateTransaction failure -> no audit log created, 500 returned', async () => {
    // A genuine ledger/network failure aborts getConsultation's try block
    // before it ever reaches a logAudit call - unlike an ACCESS_DENIED
    // policy result, which does log (an audit trail of denied attempts).
    fabricMock.__contract.evaluateTransaction.mockRejectedValueOnce(
      new Error('Fabric evaluateTransaction failed: peer unreachable')
    );

    const res = await supertest(app)
      .get('/consultations/CONS_AUDIT_001')
      .set('Authorization', `Bearer ${doctorToken}`);

    expect(res.status).toBe(500);
    expect(auditLogCalls()).toHaveLength(0);
  });

  test('unauthenticated request - no audit log created', async () => {
    const res = await supertest(app)
      .get('/consultations/CONS_AUDIT_001');

    expect(res.status).toBe(401);
    expect(auditLogCalls()).toHaveLength(0);
  });
});
