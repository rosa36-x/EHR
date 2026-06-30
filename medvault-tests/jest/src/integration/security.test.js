/**
 * integration/security.test.js
 *
 * Cross-cutting security checks:
 *   - Expired JWT rejected on every protected route category
 *   - Tampered JWT rejected
 *   - Missing body fields return 400, not 500
 *   - Duplicate record IDs rejected by Fabric
 *   - Patient cannot access another patient's audit history
 *   - No token on protected route → 401
 */

'use strict';

jest.mock('../../../../backend/services/fabricService',       () => require('../__mocks__/fabricService'));
jest.mock('../../../../backend/services/ipfsService',         () => require('../__mocks__/ipfsService'));
jest.mock('../../../../backend/services/kmsService',          () => require('../__mocks__/kmsService'));
jest.mock('../../../../backend/services/notificationService', () => require('../__mocks__/notificationService'));

const supertest    = require('supertest');
const app          = require('../../../../backend/server');
const { makeToken, expiredToken } = require('../helpers');
const fabricMock   = require('../../../../backend/services/fabricService');

process.env.MONGODB_URI = process.env.MONGODB_URI_TEST || 'mongodb://localhost:27017/medvault_test';

const DOCTOR_ID   = 'DOC_SEC_001';
const PATIENT_ID  = 'PAT_SEC_001';
const PATIENT2_ID = 'PAT_SEC_002';

const doctorToken   = makeToken('doctor',  DOCTOR_ID);
const patientToken  = makeToken('patient', PATIENT_ID);
const patient2Token = makeToken('patient', PATIENT2_ID);

// ── JWT authentication edge cases ─────────────────────────────────────────────
describe('JWT security', () => {
  const PROTECTED_ROUTES = [
    { method: 'get',   path: '/consultations/CONS_SEC_001' },
    { method: 'post',  path: '/treatment-relationships',   body: { patientID: PATIENT_ID, relationshipType: 'RECENT_APPOINTMENT' } },
    { method: 'post',  path: '/permission-requests',       body: { patientID: PATIENT_ID, resourceType: 'CONSULTATION', resourceID: 'CONS_SEC_001', reason: 'test' } },
  ];

  test.each(PROTECTED_ROUTES)(
    'no token on $method $path → 401',
    async ({ method, path, body }) => {
      let req = supertest(app)[method](path);
      if (body) req = req.send(body);
      const res = await req;
      expect(res.status).toBe(401);
      expect(res.body.status).toBe('FAILED');
    }
  );

  test.each(PROTECTED_ROUTES)(
    'expired token on $method $path → 401',
    async ({ method, path, body }) => {
      const token = expiredToken('doctor', DOCTOR_ID);
      let req = supertest(app)[method](path).set('Authorization', `Bearer ${token}`);
      if (body) req = req.send(body);
      const res = await req;
      expect(res.status).toBe(401);
      expect(res.body.message).toMatch(/expired|invalid/i);
    }
  );

  test('tampered token → 401', async () => {
    const token   = makeToken('doctor', DOCTOR_ID);
    const tampered = token.slice(0, -5) + 'XXXXX';
    const res = await supertest(app)
      .get('/consultations/CONS_SEC_001')
      .set('Authorization', `Bearer ${tampered}`);

    expect(res.status).toBe(401);
    expect(res.body.status).toBe('FAILED');
  });
});

// ── Role-based access control ─────────────────────────────────────────────────
describe('Role-based access control', () => {
  test('patient token on POST /treatment-relationships → 403', async () => {
    const res = await supertest(app)
      .post('/treatment-relationships')
      .set('Authorization', `Bearer ${patientToken}`)
      .send({ patientID: PATIENT_ID, relationshipType: 'RECENT_APPOINTMENT' });

    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/doctor/i);
  });

  test('doctor token on PATCH /permission-requests/:id/approve → 403', async () => {
    const res = await supertest(app)
      .patch('/permission-requests/PREQ_SEC_001/approve')
      .set('Authorization', `Bearer ${doctorToken}`);

    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/patient/i);
  });

  test('doctor token on PATCH /permission-requests/:id/reject → 403', async () => {
    const res = await supertest(app)
      .patch('/permission-requests/PREQ_SEC_001/reject')
      .set('Authorization', `Bearer ${doctorToken}`);

    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/patient/i);
  });
});

// ── Input validation ──────────────────────────────────────────────────────────
describe('Input validation — missing required fields', () => {
  test('POST /permission-requests missing resourceType/resourceID/reason → 400', async () => {
    const res = await supertest(app)
      .post('/permission-requests')
      .set('Authorization', `Bearer ${doctorToken}`)
      .send({ patientID: PATIENT_ID }); // missing 3 required fields

    expect(res.status).toBe(400);
    expect(res.body.status).toBe('FAILED');
  });

  test('POST /treatment-relationships missing patientID → 400', async () => {
    const res = await supertest(app)
      .post('/treatment-relationships')
      .set('Authorization', `Bearer ${doctorToken}`)
      .send({ relationshipType: 'RECENT_APPOINTMENT' }); // missing patientID

    expect(res.status).toBe(400);
    expect(res.body.status).toBe('FAILED');
  });

  test('POST /doctors/register missing password → 400', async () => {
    const res = await supertest(app)
      .post('/doctors/register')
      .send({
        fullName: 'Incomplete', licenseNumber: 'X', specialization: 'X',
        hospitalID: 'X', phone: '9000000099', email: 'x@x.com',
        // password missing
      });

    expect(res.status).toBe(400);
    expect(res.body.status).toBe('FAILED');
  });
});

// ── Duplicate record IDs ──────────────────────────────────────────────────────
describe('Duplicate record IDs rejected by Fabric', () => {
  test('creating consultation with existing ID → 500 FAILED', async () => {
    fabricMock.createConsultation
      .mockResolvedValueOnce({ status: 'SUCCESS', consultationID: 'CONS_DUP', consultationCID: 'bafymock', encryptionKeyRef: 'KEY001', sensitivityLevel: 'NORMAL' })
      .mockResolvedValueOnce({ status: 'FAILED', message: 'Consultation CONS_DUP already exists on the ledger.' });

    // First creation succeeds
    const r1 = await supertest(app)
      .post('/consultations')
      .set('Authorization', `Bearer ${doctorToken}`)
      .field('consultationID', 'CONS_DUP')
      .field('patientID', PATIENT_ID)
      .field('doctorID', DOCTOR_ID)
      .field('diagnosis', 'First')
      .field('recordType', 'GENERAL')
      .attach('file', Buffer.from('%PDF-1.4'), 'test.pdf');
    expect(r1.status).toBe(200);

    // Second creation with same ID fails
    const r2 = await supertest(app)
      .post('/consultations')
      .set('Authorization', `Bearer ${doctorToken}`)
      .field('consultationID', 'CONS_DUP')
      .field('patientID', PATIENT_ID)
      .field('doctorID', DOCTOR_ID)
      .field('diagnosis', 'Duplicate')
      .field('recordType', 'GENERAL')
      .attach('file', Buffer.from('%PDF-1.4'), 'test.pdf');
    expect(r2.status).toBe(500);
    expect(r2.body.status).toBe('FAILED');
    expect(r2.body.message).toMatch(/already exists/i);
  });
});

// ── Cross-patient audit log isolation (BUG-02 related) ───────────────────────
describe('Audit log patient isolation', () => {
  test('patient2 cannot view audit log for patient1\'s record', async () => {
    // Audit log resourceID = PATIENT_ID (patient 1's record)
    fabricMock.getAuditLog.mockResolvedValueOnce({
      status: 'SUCCESS',
      data: {
        auditID:      'AUD_ISOLATION_001',
        actorID:      DOCTOR_ID,
        actorRole:    'doctor',
        action:       'READ',
        resourceType: 'CONSULTATION',
        resourceID:   PATIENT_ID, // patient 1's record
        timestamp:    new Date().toISOString(),
      },
    });

    // patient2 should NOT be able to view this log — neither actorID nor resourceID matches them
    const res = await supertest(app)
      .get('/audit-history/AUD_ISOLATION_001')
      .set('Authorization', `Bearer ${patient2Token}`);

    expect(res.status).toBe(403);
    expect(res.body.status).toBe('FAILED');
  });

  test('patient1 CAN view audit log for their own record (BUG-02 regression)', async () => {
    fabricMock.getAuditLog.mockResolvedValueOnce({
      status: 'SUCCESS',
      data: {
        auditID:      'AUD_OWN_001',
        actorID:      DOCTOR_ID,  // actor is the doctor
        actorRole:    'doctor',
        action:       'READ',
        resourceType: 'CONSULTATION',
        resourceID:   PATIENT_ID, // patient 1's own record — should be visible to them
        timestamp:    new Date().toISOString(),
      },
    });

    const res = await supertest(app)
      .get('/audit-history/AUD_OWN_001')
      .set('Authorization', `Bearer ${patientToken}`);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('SUCCESS');
  });
});
