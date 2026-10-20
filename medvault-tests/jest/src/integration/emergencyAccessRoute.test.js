/**
 * integration/emergencyAccessRoute.test.js
 *
 * POST /emergency-access input handling and throttling. Mounts only the
 * emergency router (real auth middleware, real JWTs) with the service mocked:
 *   - doctor role only
 *   - patientID / reason must be strings; reason length bounded
 *   - the service only ever receives { patientID, doctorID (from JWT), reason }
 *     -- body doctorID / status / emergencyAccessID are never forwarded
 *   - NOT_FOUND -> 404, duplicate -> 409, other failures -> 500
 *   - per-doctor rate limit -> 429
 */

'use strict';

process.env.EMERGENCY_RATE_LIMIT_MAX = '3'; // must be set before the router is loaded

jest.mock('../../../../backend/services/fabricService',     () => require('../__mocks__/fabricService'));
jest.mock('../../../../backend/services/notificationService', () => require('../__mocks__/notificationService'));
jest.mock('../../../../backend/services/idService',         () => ({ generateID: () => 'ID_0001' }));
jest.mock('../../../../backend/services/db', () => ({
  Doctor: {}, PatientAuth: {}, OTP: {}, OrgActor: { findOne: jest.fn() },
}));
jest.mock('../../../../backend/services/emergencyFabricService', () => ({
  createEmergencyAccess: jest.fn(),
  getEmergencyAccess:    jest.fn(),
  closeEmergencyAccess:  jest.fn(),
}));

const express   = require('express');
const supertest = require('supertest');
const { makeToken } = require('../helpers');
const emergencySvc  = require('../../../../backend/services/emergencyFabricService');
const router        = require('../../../../backend/routes/emergency').default;

const app = express();
app.use(express.json());
app.use('/emergency-access', router);

const REASON = 'Patient unconscious, needs immediate treatment';
let n = 0;
// A fresh doctor per test keeps the per-doctor rate limiter from bleeding across tests.
const newDoctor = () => { const id = `DOC_RT_${++n}`; return { id, token: makeToken('doctor', id) }; };
const post = (token, body) =>
  supertest(app).post('/emergency-access').set('Authorization', `Bearer ${token}`).send(body);

beforeEach(() => {
  emergencySvc.createEmergencyAccess.mockReset();
  emergencySvc.createEmergencyAccess.mockResolvedValue({ status: 'SUCCESS', emergencyAccessID: 'EA0001' });
});

describe('POST /emergency-access', () => {
  test('patient role -> 403', async () => {
    const res = await post(makeToken('patient', 'PAT_RT_1'), { patientID: 'PAT_RT_1', reason: REASON });
    expect(res.status).toBe(403);
    expect(emergencySvc.createEmergencyAccess).not.toHaveBeenCalled();
  });

  test.each([
    ['missing patientID',        { reason: REASON }],
    ['missing reason',           { patientID: 'PAT_X' }],
    ['non-string reason',        { patientID: 'PAT_X', reason: 12345678901 }],
    ['object patientID (NoSQL)', { patientID: { $ne: null }, reason: REASON }],
    ['reason too short',         { patientID: 'PAT_X', reason: 'urgent' }],
    ['reason only whitespace',   { patientID: 'PAT_X', reason: '            ' }],
    ['reason too long',          { patientID: 'PAT_X', reason: 'x'.repeat(1001) }],
  ])('%s -> 400, service not called', async (_name, body) => {
    const { token } = newDoctor();
    const res = await post(token, body);
    expect(res.status).toBe(400);
    expect(emergencySvc.createEmergencyAccess).not.toHaveBeenCalled();
  });

  test('valid request -> 200; service gets only patientID, JWT doctorID and trimmed reason', async () => {
    const { id, token } = newDoctor();
    const res = await post(token, {
      patientID: ' PAT_X ', reason: `  ${REASON}  `,
      doctorID: 'DOC_SPOOF', status: 'CLOSED', emergencyAccessID: 'EA_FORGED',
    });
    expect(res.status).toBe(200);
    expect(emergencySvc.createEmergencyAccess).toHaveBeenCalledTimes(1);
    const [data, actor] = emergencySvc.createEmergencyAccess.mock.calls[0];
    expect(data).toEqual({ patientID: 'PAT_X', doctorID: id, reason: REASON });
    expect(actor).toBe(id);
  });

  test('service result codes: NOT_FOUND 404, duplicate 409, other 500', async () => {
    const { token } = newDoctor();
    emergencySvc.createEmergencyAccess.mockResolvedValueOnce({ status: 'NOT_FOUND', message: 'Patient PAT_X not found.' });
    expect((await post(token, { patientID: 'PAT_X', reason: REASON })).status).toBe(404);

    emergencySvc.createEmergencyAccess.mockResolvedValueOnce({ status: 'FAILED', message: 'You already have active emergency access to this patient' });
    expect((await post(token, { patientID: 'PAT_X', reason: REASON })).status).toBe(409);

    emergencySvc.createEmergencyAccess.mockResolvedValueOnce({ status: 'FAILED', message: 'ledger down' });
    expect((await post(token, { patientID: 'PAT_X', reason: REASON })).status).toBe(500);
  });

  test('per-doctor rate limit: 4th request in the window -> 429, other doctors unaffected', async () => {
    const a = newDoctor();
    const b = newDoctor();
    for (let i = 0; i < 3; i++) {
      expect((await post(a.token, { patientID: 'PAT_X', reason: REASON })).status).toBe(200);
    }
    const blocked = await post(a.token, { patientID: 'PAT_X', reason: REASON });
    expect(blocked.status).toBe(429);
    expect(blocked.body.status).toBe('FAILED');
    expect((await post(b.token, { patientID: 'PAT_X', reason: REASON })).status).toBe(200);
  });
});
