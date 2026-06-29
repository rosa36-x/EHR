/**
 * integration/auditMiddleware.test.js
 *
 * Verifies that auditMiddleware auto-generates an audit log entry
 * on every record access, without requiring the route handler to
 * explicitly call createAuditLog.
 *
 * Tests:
 *   1. Reading a consultation generates an AUD entry with correct fields
 *   2. A failed request (non-200) does NOT generate an audit entry
 *   3. Audit entry actorID matches the JWT subject
 *   4. Audit entry action is READ for GET requests
 */

'use strict';

jest.mock('../../../backend/services/fabricService',       () => require('../__mocks__/fabricService'));
jest.mock('../../../backend/services/ipfsService',         () => require('../__mocks__/ipfsService'));
jest.mock('../../../backend/services/kmsService',          () => require('../__mocks__/kmsService'));
jest.mock('../../../backend/services/notificationService', () => require('../__mocks__/notificationService'));

const supertest    = require('supertest');
const app          = require('../../../backend/server');
const { makeToken }= require('../helpers');
const fabricMock   = require('../../../backend/services/fabricService');

process.env.MONGODB_URI = process.env.MONGODB_URI_TEST || 'mongodb://localhost:27017/medvault_test';

const DOCTOR_ID  = 'DOC_AUDIT_001';
const PATIENT_ID = 'PAT_AUDIT_001';
const doctorToken = makeToken('doctor', DOCTOR_ID);

beforeAll(() => {
  fabricMock.getConsultation.mockResolvedValue({
    status: 'SUCCESS',
    data: {
      consultationID:   'CONS_AUDIT_001',
      patientID:        PATIENT_ID,
      sensitivityLevel: 'NORMAL',
      consultationCID:  'bafymock-audit-cid',
      encryptionKeyRef: 'KEY_AUDIT_001',
    },
  });
});

beforeEach(() => {
  fabricMock.createAuditLog.mockClear();
});

describe('auditMiddleware — auto-generated audit logs', () => {
  test('GET /consultations/:id → createAuditLog called once', async () => {
    const res = await supertest(app)
      .get('/consultations/CONS_AUDIT_001')
      .set('Authorization', `Bearer ${doctorToken}`);

    expect(res.status).toBe(200);
    expect(fabricMock.createAuditLog).toHaveBeenCalledTimes(1);
  });

  test('audit log actorID matches doctor token subject', async () => {
    await supertest(app)
      .get('/consultations/CONS_AUDIT_001')
      .set('Authorization', `Bearer ${doctorToken}`);

    const [auditPayload] = fabricMock.createAuditLog.mock.calls[0];
    expect(auditPayload.actorID).toBe(DOCTOR_ID);
    expect(auditPayload.actorRole).toBe('doctor');
  });

  test('audit log action is READ for GET request', async () => {
    await supertest(app)
      .get('/consultations/CONS_AUDIT_001')
      .set('Authorization', `Bearer ${doctorToken}`);

    const [auditPayload] = fabricMock.createAuditLog.mock.calls[0];
    expect(auditPayload.action).toBe('READ');
  });

  test('audit log resourceType and resourceID are correct', async () => {
    await supertest(app)
      .get('/consultations/CONS_AUDIT_001')
      .set('Authorization', `Bearer ${doctorToken}`);

    const [auditPayload] = fabricMock.createAuditLog.mock.calls[0];
    expect(auditPayload.resourceType).toMatch(/CONSULTATION/i);
    expect(auditPayload.resourceID).toBe('CONS_AUDIT_001');
  });

  test('failed Fabric call (ACCESS_DENIED) — no audit log created', async () => {
    fabricMock.getConsultation.mockResolvedValueOnce({
      status: 'ACCESS_DENIED',
      requiresPermission: true,
      resourceID: 'CONS_AUDIT_001',
      message: 'SENSITIVE record requires explicit permission.',
    });

    const res = await supertest(app)
      .get('/consultations/CONS_AUDIT_001')
      .set('Authorization', `Bearer ${doctorToken}`);

    expect(res.status).toBe(500);
    // Audit middleware should NOT fire on failed/denied responses
    expect(fabricMock.createAuditLog).not.toHaveBeenCalled();
  });

  test('unauthenticated request — no audit log created', async () => {
    const res = await supertest(app)
      .get('/consultations/CONS_AUDIT_001');

    expect(res.status).toBe(401);
    expect(fabricMock.createAuditLog).not.toHaveBeenCalled();
  });
});
