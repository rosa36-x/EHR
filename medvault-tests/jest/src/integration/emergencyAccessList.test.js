/**
 * integration/emergencyAccessList.test.js
 *
 * GET /emergency-access -- the calling doctor's own active emergency accesses.
 * Mounts only the emergency router (real auth middleware, real JWTs) with the
 * service mocked:
 *   - no token -> 401; patient role -> 403; neither reaches the service
 *   - the service is always asked about the doctor in the JWT, never one named
 *     in the query string or body
 *   - SUCCESS -> 200 with the service's data; any other status -> 500
 *   - the list route does not swallow GET /emergency-access/:id
 */

'use strict';

jest.mock('../../../../backend/services/fabricService',       () => require('../__mocks__/fabricService'));
jest.mock('../../../../backend/services/notificationService', () => require('../__mocks__/notificationService'));
jest.mock('../../../../backend/services/idService',           () => ({ generateID: () => 'ID_0001' }));
jest.mock('../../../../backend/services/db', () => ({
  Doctor: {}, PatientAuth: {}, OTP: {}, OrgActor: { findOne: jest.fn() },
}));
jest.mock('../../../../backend/services/emergencyFabricService', () => ({
  createEmergencyAccess:     jest.fn(),
  getEmergencyAccess:        jest.fn(),
  closeEmergencyAccess:      jest.fn(),
  listActiveEmergencyAccess: jest.fn(),
}));

const express   = require('express');
const supertest = require('supertest');
const { makeToken } = require('../helpers');
const emergencySvc  = require('../../../../backend/services/emergencyFabricService');
const router        = require('../../../../backend/routes/emergency').default;

const app = express();
app.use(express.json());
app.use('/emergency-access', router);

const doctorToken = makeToken('doctor', 'DOC_LIST_1');
const get = (path = '/emergency-access', token = doctorToken) => {
  const req = supertest(app).get(path);
  if (token) req.set('Authorization', `Bearer ${token}`);
  return req;
};

const sample = [{
  emergencyAccessID: 'EA_L1', relationshipID: 'TR_L1', patientID: 'PAT_L1',
  reason: 'unconscious', status: 'ACTIVE', createdAt: 'c', expiresAt: 'e',
}];

beforeEach(() => {
  emergencySvc.listActiveEmergencyAccess.mockReset();
  emergencySvc.getEmergencyAccess.mockReset();
  emergencySvc.listActiveEmergencyAccess.mockResolvedValue({ status: 'SUCCESS', data: sample });
});

describe('GET /emergency-access', () => {
  test('no token -> 401, service not called', async () => {
    const res = await get('/emergency-access', null);
    expect(res.status).toBe(401);
    expect(emergencySvc.listActiveEmergencyAccess).not.toHaveBeenCalled();
  });

  test('patient role -> 403, service not called', async () => {
    const res = await get('/emergency-access', makeToken('patient', 'PAT_LIST_1'));
    expect(res.status).toBe(403);
    expect(emergencySvc.listActiveEmergencyAccess).not.toHaveBeenCalled();
  });

  test('doctor -> 200 with the service data', async () => {
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'SUCCESS', data: sample });
  });

  test('the service is asked about the doctor in the JWT, whatever the query says', async () => {
    await get('/emergency-access?doctorID=DOC_OTHER&patientID=PAT_X');
    expect(emergencySvc.listActiveEmergencyAccess).toHaveBeenCalledTimes(1);
    expect(emergencySvc.listActiveEmergencyAccess).toHaveBeenCalledWith('DOC_LIST_1');
  });

  test('service failure -> 500', async () => {
    emergencySvc.listActiveEmergencyAccess.mockResolvedValue({ status: 'FAILED', message: 'mongo down' });
    const res = await get();
    expect(res.status).toBe(500);
    expect(res.body.status).toBe('FAILED');
  });

  test('GET /emergency-access/:id still reaches the single-record handler', async () => {
    emergencySvc.getEmergencyAccess.mockResolvedValue({ status: 'SUCCESS', data: { emergencyAccessID: 'EA_L1' } });
    const res = await get('/emergency-access/EA_L1');
    expect(res.status).toBe(200);
    expect(emergencySvc.getEmergencyAccess).toHaveBeenCalledTimes(1);
    expect(emergencySvc.listActiveEmergencyAccess).not.toHaveBeenCalled();
  });
});
