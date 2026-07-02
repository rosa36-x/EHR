/**
 * integration/treatmentRelationship.test.js
 *
 * Tests the full treatment relationship lifecycle:
 *   create -> get (ACTIVE) -> dormant -> get (DORMANT) -> reactivate -> get (ACTIVE)
 *   Plus: access guard (consultation denied when no active TR)
 *
 * Mocked:  treatmentRelationshipFabricService, consultationFabricService,
 *          fabricService (low-level baseline), ipfsService, kmsService,
 *          notificationService
 */

'use strict';

jest.mock('../../../../backend/services/fabricService',                    () => require('../__mocks__/fabricService'));
jest.mock('../../../../backend/services/treatmentRelationshipFabricService', () => require('../__mocks__/treatmentRelationshipFabricService'));
jest.mock('../../../../backend/services/consultationFabricService',        () => require('../__mocks__/consultationFabricService'));
jest.mock('../../../../backend/services/ipfsService',                     () => require('../__mocks__/ipfsService'));
jest.mock('../../../../backend/services/kmsService',                      () => require('../__mocks__/kmsService'));
jest.mock('../../../../backend/services/notificationService',             () => require('../__mocks__/notificationService'));

const supertest      = require('supertest');
const app            = require('../../../../backend/server');
const { makeToken }  = require('../helpers');
const treatmentMock    = require('../../../../backend/services/treatmentRelationshipFabricService');
const consultationMock = require('../../../../backend/services/consultationFabricService');

process.env.MONGODB_URI = process.env.MONGODB_URI_TEST || 'mongodb://localhost:27017/medvault_test';

const DOCTOR_ID  = 'DOC_TR_001';
const PATIENT_ID = 'PAT_TR_001';
const doctorToken = makeToken('doctor',  DOCTOR_ID);

const TR_ID = 'TR_LIFECYCLE_001';
let trStatus = 'ACTIVE';

beforeAll(() => {
  treatmentMock.createTreatmentRelationship.mockResolvedValue({
    status: 'SUCCESS', relationshipID: TR_ID,
  });

  treatmentMock.getTreatmentRelationship.mockImplementation(async (id) => ({
    status: 'SUCCESS',
    data: { relationshipID: id, doctorID: DOCTOR_ID, patientID: PATIENT_ID, status: trStatus },
  }));

  treatmentMock.markDormant.mockImplementation(async () => {
    trStatus = 'DORMANT';
    return { status: 'SUCCESS' };
  });

  treatmentMock.reactivateTreatmentRelationship.mockImplementation(async () => {
    trStatus = 'ACTIVE';
    return { status: 'SUCCESS' };
  });

  // Consultation access - blocked when TR is DORMANT
  consultationMock.getConsultation.mockImplementation(async (id) => {
    if (trStatus !== 'ACTIVE') {
      return {
        status:  'ACCESS_DENIED',
        message: 'No active treatment relationship between doctor and patient.',
      };
    }
    return {
      status: 'SUCCESS',
      data: { consultationID: id, patientID: PATIENT_ID, sensitivityLevel: 'NORMAL' },
    };
  });
});

describe('Treatment relationship lifecycle', () => {
  test('POST /treatment-relationships -> 200, TR_ID returned', async () => {
    const res = await supertest(app)
      .post('/treatment-relationships')
      .set('Authorization', `Bearer ${doctorToken}`)
      .send({ patientID: PATIENT_ID, relationshipType: 'RECENT_APPOINTMENT' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('SUCCESS');
    expect(res.body.relationshipID).toBe(TR_ID);
  });

  test('GET /treatment-relationships/:id -> status ACTIVE', async () => {
    const res = await supertest(app)
      .get(`/treatment-relationships/${TR_ID}`)
      .set('Authorization', `Bearer ${doctorToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('ACTIVE');
  });

  test('GET /consultations/:id while ACTIVE -> 200', async () => {
    const res = await supertest(app)
      .get('/consultations/CONS_TR_TEST_001')
      .set('Authorization', `Bearer ${doctorToken}`);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('SUCCESS');
  });

  test('PATCH /treatment-relationships/:id/dormant -> 200', async () => {
    const res = await supertest(app)
      .patch(`/treatment-relationships/${TR_ID}/dormant`)
      .set('Authorization', `Bearer ${doctorToken}`);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('SUCCESS');
  });

  test('GET /treatment-relationships/:id -> status DORMANT', async () => {
    const res = await supertest(app)
      .get(`/treatment-relationships/${TR_ID}`)
      .set('Authorization', `Bearer ${doctorToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('DORMANT');
  });

  test('GET /consultations/:id while DORMANT -> ACCESS_DENIED', async () => {
    const res = await supertest(app)
      .get('/consultations/CONS_TR_TEST_001')
      .set('Authorization', `Bearer ${doctorToken}`);

    expect(res.status).toBe(500);
    expect(res.body.status).toBe('ACCESS_DENIED');
  });

  test('PATCH /treatment-relationships/:id/reactivate -> 200', async () => {
    const res = await supertest(app)
      .patch(`/treatment-relationships/${TR_ID}/reactivate`)
      .set('Authorization', `Bearer ${doctorToken}`);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('SUCCESS');
  });

  test('GET /consultations/:id after reactivation -> 200 again', async () => {
    const res = await supertest(app)
      .get('/consultations/CONS_TR_TEST_001')
      .set('Authorization', `Bearer ${doctorToken}`);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('SUCCESS');
  });

  test('patient token on POST /treatment-relationships -> 403', async () => {
    const patientToken = makeToken('patient', PATIENT_ID);
    const res = await supertest(app)
      .post('/treatment-relationships')
      .set('Authorization', `Bearer ${patientToken}`)
      .send({ patientID: PATIENT_ID, relationshipType: 'RECENT_APPOINTMENT' });

    expect(res.status).toBe(403);
  });

  test('invalid relationshipType -> 500 FAILED', async () => {
    treatmentMock.createTreatmentRelationship.mockResolvedValueOnce({
      status: 'FAILED', message: 'Invalid type. Must be one of: RECENT_APPOINTMENT, ...',
    });

    const res = await supertest(app)
      .post('/treatment-relationships')
      .set('Authorization', `Bearer ${doctorToken}`)
      .send({ patientID: PATIENT_ID, relationshipType: 'INVALID_TYPE' });

    expect(res.status).toBe(500);
    expect(res.body.status).toBe('FAILED');
  });
});
