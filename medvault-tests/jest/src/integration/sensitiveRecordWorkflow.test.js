/**
 * integration/sensitiveRecordWorkflow.test.js
 *
 * End-to-end workflow:
 *   1. Doctor creates a SENSITIVE consultation (PSYCHIATRY)
 *   2. Doctor tries to read it -> ACCESS_DENIED
 *   3. Doctor creates a permission request
 *   4. Patient approves the request
 *   5. Doctor reads it -> SUCCESS, accessExpires in ~48h
 *   6. Patient views audit history for the record (BUG-02 regression)
 *   7. Permission request approve called again -> FAILED (idempotency)
 *
 * This test controls the workflow directly via domain-level mocks of
 * consultationFabricService and permissionRequestFabricService, rather than
 * exercising the real sensitivity/permission-check logic inside them - that
 * real logic is covered separately in auditMiddleware.test.js. The one
 * exception is Step 6 (/audit-history/:id), which bypasses both domain
 * services and calls fabricService.getContract directly in the real route,
 * so it needs the low-level fabricService mock instead.
 *
 * Mocked:  fabricService (low-level), consultationFabricService,
 *          permissionRequestFabricService, ipfsService, kmsService,
 *          notificationService
 * Real:    Express routes, authMiddleware
 */

'use strict';

jest.mock('../../../../backend/services/fabricService',                  () => require('../__mocks__/fabricService'));
jest.mock('../../../../backend/services/consultationFabricService',      () => require('../__mocks__/consultationFabricService'));
jest.mock('../../../../backend/services/permissionRequestFabricService', () => require('../__mocks__/permissionRequestFabricService'));
jest.mock('../../../../backend/services/ipfsService',                    () => require('../__mocks__/ipfsService'));
jest.mock('../../../../backend/services/kmsService',                     () => require('../__mocks__/kmsService'));
jest.mock('../../../../backend/services/notificationService',            () => require('../__mocks__/notificationService'));

const supertest      = require('supertest');
const app            = require('../../../../backend/server');
const { makeToken }  = require('../helpers');
const fabricMock      = require('../../../../backend/services/fabricService');
const consultationMock = require('../../../../backend/services/consultationFabricService');
const permissionMock   = require('../../../../backend/services/permissionRequestFabricService');

process.env.MONGODB_URI = process.env.MONGODB_URI_TEST || 'mongodb://localhost:27017/medvault_test';

const DOCTOR_ID  = 'DOC_WF_001';
const PATIENT_ID = 'PAT_WF_001';
const doctorToken  = makeToken('doctor',  DOCTOR_ID);
const patientToken = makeToken('patient', PATIENT_ID);

const CONS_ID = 'CONS_SENSITIVE_WF_001';

let permissionRequestID;

// -- seed mock responses for this workflow --------------------------------------
beforeAll(() => {
  let permissionGranted = false;
  let approved = false;

  consultationMock.getConsultation.mockImplementation(async (id, actorID, actorRole) => {
    if (id !== CONS_ID) {
      return { status: 'FAILED', message: 'Not found' };
    }
    if (!permissionGranted && actorRole === 'doctor') {
      return {
        status:             'ACCESS_DENIED',
        requiresPermission: true,
        resourceID:         id,
        message:            'Record is SENSITIVE. Explicit patient permission required.',
      };
    }
    return {
      status: 'SUCCESS',
      data: {
        consultationID:   id,
        patientID:        PATIENT_ID,
        sensitivityLevel: 'SENSITIVE',
        consultationCID:  'bafymock-sensitive-cid',
        encryptionKeyRef: 'KEY_SENSITIVE_001',
      },
    };
  });

  permissionMock.approvePermissionRequest.mockImplementation(async () => {
    if (approved) {
      return { status: 'FAILED', message: 'Request is not in PENDING status.' };
    }
    approved = true;
    permissionGranted = true;
    return {
      status:        'SUCCESS',
      accessExpires: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
    };
  });

  permissionMock.createPermissionRequest.mockResolvedValue({
    status:    'SUCCESS',
    requestID: 'PREQ_WF_001',
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  });

  permissionMock.getPermissionRequest.mockResolvedValue({
    status: 'SUCCESS',
    data: {
      requestID:  'PREQ_WF_001',
      doctorID:   DOCTOR_ID,
      patientID:  PATIENT_ID,
      resourceID: CONS_ID,
      status:     'PENDING',
    },
  });

  // /audit-history/:id bypasses both domain services above and calls
  // fabricService.getContract directly in the real route - handle it here.
  fabricMock.__contract.evaluateTransaction.mockImplementation(async (fnName, auditID) => {
    if (fnName === 'GetAuditLog') {
      return Buffer.from(JSON.stringify({
        auditID,
        actorID:      DOCTOR_ID,
        actorRole:    'doctor',
        action:       'READ',
        resourceType: 'CONSULTATION',
        resourceID:   PATIENT_ID, // resourceID = patientID for auto-generated audit logs
        timestamp:    new Date().toISOString(),
      }));
    }
    return Buffer.from('{}');
  });
});

// -- Step 1: Create sensitive consultation --------------------------------------
describe('Step 1: Doctor creates SENSITIVE consultation', () => {
  test('POST /consultations with PSYCHIATRY -> 200, sensitivityLevel SENSITIVE', async () => {
    consultationMock.createConsultation.mockResolvedValueOnce({
      status:           'SUCCESS',
      consultationID:   CONS_ID,
      consultationCID:  'bafymock-sensitive-cid',
      encryptionKeyRef: 'KEY_SENSITIVE_001',
      sensitivityLevel: 'SENSITIVE',
    });

    const res = await supertest(app)
      .post('/consultations')
      .set('Authorization', `Bearer ${doctorToken}`)
      .field('consultationID', CONS_ID)
      .field('patientID',      PATIENT_ID)
      .field('doctorID',       DOCTOR_ID)
      .field('diagnosis',      'Generalised Anxiety Disorder')
      .field('recordType',     'PSYCHIATRY')
      .attach('file', Buffer.from('%PDF-1.4 test'), 'test.pdf');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('SUCCESS');
    expect(res.body.sensitivityLevel).toBe('SENSITIVE');
  });
});

// -- Step 2: Doctor reads - ACCESS_DENIED ---------------------------------------
describe('Step 2: Doctor reads sensitive record - denied', () => {
  test('GET /consultations/:id -> ACCESS_DENIED (no permission yet)', async () => {
    const res = await supertest(app)
      .get(`/consultations/${CONS_ID}`)
      .set('Authorization', `Bearer ${doctorToken}`);

    expect(res.status).toBe(500);
    expect(res.body.status).toBe('ACCESS_DENIED');
    expect(res.body.requiresPermission).toBe(true);
  });
});

// -- Step 3: Doctor creates permission request ----------------------------------
describe('Step 3: Doctor creates permission request', () => {
  test('POST /permission-requests -> 200, requestID returned', async () => {
    const res = await supertest(app)
      .post('/permission-requests')
      .set('Authorization', `Bearer ${doctorToken}`)
      .send({
        patientID:    PATIENT_ID,
        resourceType: 'CONSULTATION',
        resourceID:   CONS_ID,
        reason:       'Patient re-presented; reviewing psychiatric history.',
      });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('SUCCESS');
    expect(res.body.requestID).toMatch(/^PREQ/);
    permissionRequestID = res.body.requestID;

    const expiresAt = new Date(res.body.expiresAt).getTime();
    const diffHours = (expiresAt - Date.now()) / (1000 * 60 * 60);
    expect(diffHours).toBeGreaterThan(23);
    expect(diffHours).toBeLessThan(25);
  });
});

// -- Step 4: Patient approves -----------------------------------------------------
describe('Step 4: Patient approves permission request', () => {
  test('PATCH /permission-requests/:id/approve with patient token -> 200', async () => {
    const res = await supertest(app)
      .patch(`/permission-requests/${permissionRequestID}/approve`)
      .set('Authorization', `Bearer ${patientToken}`);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('SUCCESS');

    const diffHours = (new Date(res.body.accessExpires).getTime() - Date.now()) / (1000 * 60 * 60);
    expect(diffHours).toBeGreaterThan(47);
    expect(diffHours).toBeLessThan(49);
  });

  test('doctor token on /approve -> 403 (role guard)', async () => {
    const res = await supertest(app)
      .patch(`/permission-requests/${permissionRequestID}/approve`)
      .set('Authorization', `Bearer ${doctorToken}`);

    expect(res.status).toBe(403);
    expect(res.body.status).toBe('FAILED');
  });
});

// -- Step 5: Doctor reads successfully after approval ----------------------------
describe('Step 5: Doctor reads sensitive record - granted', () => {
  test('GET /consultations/:id after approval -> 200, SENSITIVE data returned', async () => {
    const res = await supertest(app)
      .get(`/consultations/${CONS_ID}`)
      .set('Authorization', `Bearer ${doctorToken}`);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('SUCCESS');
    expect(res.body.data.sensitivityLevel).toBe('SENSITIVE');
  });
});

// -- Step 6: BUG-02 regression - patient views audit history for own record -----
describe('Step 6: Patient views audit history (BUG-02 regression)', () => {
  test('patient can view audit log where resourceID matches their patientID', async () => {
    // The audit log was auto-generated when doctor read the record.
    // resourceID in that audit log = PATIENT_ID (the patient whose record was accessed).
    // BUG-02 fix: patient should be allowed to see this log.
    const res = await supertest(app)
      .get('/audit-history/AUD_WF_AUTO_001')
      .set('Authorization', `Bearer ${patientToken}`);

    // 200 = patient has correct access after BUG-02 fix
    // If this is still 403, the fix wasn't applied
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('SUCCESS');
  });
});

// -- Step 7: Double-approve idempotency ------------------------------------------
describe('Step 7: Double-approve is rejected', () => {
  test('PATCH /approve on already-approved request -> FAILED', async () => {
    const res = await supertest(app)
      .patch(`/permission-requests/${permissionRequestID}/approve`)
      .set('Authorization', `Bearer ${patientToken}`);

    expect(res.status).toBe(500);
    expect(res.body.status).toBe('FAILED');
    expect(res.body.message).toMatch(/PENDING|already|Invalid/i);
  });
});
