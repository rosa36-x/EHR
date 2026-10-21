/**
 * integration/treatmentRelationshipApproval.test.js
 *
 * Patient-approval flow for treatment relationships:
 *   - a doctor's POST only requests a relationship (PENDING); the route never
 *     asks the service to skip approval
 *   - ASSIGNED_EMERGENCY_PHYSICIAN is refused on the doctor route (403)
 *   - only the patient role can approve / reject
 *   - a patient cannot approve someone else's relationship (service ACCESS_DENIED -> 403)
 *
 * Mocked: treatmentRelationshipFabricService, consultationFabricService,
 *         fabricService, ipfsService, kmsService, notificationService
 */

'use strict';

jest.mock('../../../../backend/services/fabricService',                    () => require('../__mocks__/fabricService'));
jest.mock('../../../../backend/services/treatmentRelationshipFabricService', () => require('../__mocks__/treatmentRelationshipFabricService'));
jest.mock('../../../../backend/services/consultationFabricService',        () => require('../__mocks__/consultationFabricService'));
jest.mock('../../../../backend/services/ipfsService',                     () => require('../__mocks__/ipfsService'));
jest.mock('../../../../backend/services/kmsService',                      () => require('../__mocks__/kmsService'));
jest.mock('../../../../backend/services/notificationService',             () => require('../__mocks__/notificationService'));

const supertest     = require('supertest');
const app           = require('../../../../backend/server').default;
const { makeToken } = require('../helpers');
const treatmentMock = require('../../../../backend/services/treatmentRelationshipFabricService');

process.env.MONGODB_URI = process.env.MONGODB_URI_TEST || 'mongodb://localhost:27017/medvault_test';

const DOCTOR_ID  = 'DOC_APPR_001';
const PATIENT_ID = 'PAT_APPR_001';
const TR_ID      = 'TR_APPR_001';
const doctorToken  = makeToken('doctor',  DOCTOR_ID);
const patientToken = makeToken('patient', PATIENT_ID);

beforeEach(() => treatmentMock.__resetAll());

describe('Treatment relationship patient approval', () => {
  test('doctor POST -> 200 and the route never skips approval', async () => {
    treatmentMock.createTreatmentRelationship.mockResolvedValueOnce({
      status: 'SUCCESS', relationshipID: TR_ID,
      relationshipStatus: 'PENDING', requiresPatientApproval: true,
    });

    const res = await supertest(app)
      .post('/treatment-relationships')
      .set('Authorization', `Bearer ${doctorToken}`)
      .send({ patientID: PATIENT_ID, relationshipType: 'RECENT_APPOINTMENT' });

    expect(res.status).toBe(200);
    expect(res.body.relationshipStatus).toBe('PENDING');
    const call = treatmentMock.createTreatmentRelationship.mock.calls[0];
    expect(call[0]).toEqual(expect.objectContaining({ doctorID: DOCTOR_ID, patientID: PATIENT_ID }));
    expect(call.length).toBe(1); // no { requirePatientApproval: false } from the route
  });

  test('doctor POST ASSIGNED_EMERGENCY_PHYSICIAN -> 403', async () => {
    treatmentMock.createTreatmentRelationship.mockResolvedValueOnce({
      status: 'ACCESS_DENIED', message: 'emergency only',
    });

    const res = await supertest(app)
      .post('/treatment-relationships')
      .set('Authorization', `Bearer ${doctorToken}`)
      .send({ patientID: PATIENT_ID, relationshipType: 'ASSIGNED_EMERGENCY_PHYSICIAN' });

    expect(res.status).toBe(403);
    expect(res.body.status).toBe('ACCESS_DENIED');
  });

  test('patient PATCH approve -> 200, service called with patient id from token', async () => {
    const res = await supertest(app)
      .patch(`/treatment-relationships/${TR_ID}/approve`)
      .set('Authorization', `Bearer ${patientToken}`);

    expect(res.status).toBe(200);
    expect(treatmentMock.approveTreatmentRelationship).toHaveBeenCalledWith(TR_ID, PATIENT_ID);
  });

  test('doctor PATCH approve -> 403, service not called', async () => {
    const res = await supertest(app)
      .patch(`/treatment-relationships/${TR_ID}/approve`)
      .set('Authorization', `Bearer ${doctorToken}`);

    expect(res.status).toBe(403);
    expect(treatmentMock.approveTreatmentRelationship).not.toHaveBeenCalled();
  });

  test('patient approving someone else\'s relationship -> 403', async () => {
    treatmentMock.approveTreatmentRelationship.mockResolvedValueOnce({
      status: 'ACCESS_DENIED', message: 'not yours',
    });

    const res = await supertest(app)
      .patch(`/treatment-relationships/${TR_ID}/approve`)
      .set('Authorization', `Bearer ${patientToken}`);

    expect(res.status).toBe(403);
    expect(res.body.status).toBe('ACCESS_DENIED');
  });

  test('patient PATCH reject -> 200; doctor PATCH reject -> 403', async () => {
    const ok = await supertest(app)
      .patch(`/treatment-relationships/${TR_ID}/reject`)
      .set('Authorization', `Bearer ${patientToken}`);
    expect(ok.status).toBe(200);
    expect(treatmentMock.rejectTreatmentRelationship).toHaveBeenCalledWith(TR_ID, PATIENT_ID);

    const denied = await supertest(app)
      .patch(`/treatment-relationships/${TR_ID}/reject`)
      .set('Authorization', `Bearer ${doctorToken}`);
    expect(denied.status).toBe(403);
  });
});
