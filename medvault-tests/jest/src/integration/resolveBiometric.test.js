/**
 * integration/resolveBiometric.test.js
 *
 * POST /patients/resolve-biometric -- the entry point for emergency access when
 * the doctor has no patientID (unconscious / unidentified patient). Mounts only
 * the patient router with real auth middleware, real JWTs and the REAL UIDAI
 * mock, so the fingerprint -> aadhaarHash -> PatientAuth lookup runs for real.
 * Only the database and Fabric are mocked.
 *
 *   - no token -> 401
 *   - missing fingerprintTemplate -> 400
 *   - template the UIDAI mock does not know -> 400, no database lookup
 *   - known template, patient registered -> 200 with patientID and fullName
 *   - known template, no registered patient -> 404 (not an access grant)
 *   - the lookup uses the HMAC aadhaarHash, and the response never exposes it
 *     or the raw Aadhaar number
 *   - different templates resolve to different patients
 */

'use strict';

const crypto = require('crypto');

jest.mock('../../../../backend/services/fabricService',       () => require('../__mocks__/fabricService'));
jest.mock('../../../../backend/services/notificationService', () => require('../__mocks__/notificationService'));
jest.mock('../../../../backend/services/idService',           () => ({ generateID: () => 'ID_0001' }));
jest.mock('../../../../backend/services/db', () => ({
  Doctor: {}, OTP: {}, OrgActor: { findOne: jest.fn() },
  PatientAuth: { findOne: jest.fn() },
}));
jest.mock('../../../../backend/services/patientFabricService', () => ({}));
// backend/temp/ is gitignored, so this file may not exist in a fresh checkout.
jest.mock('../../../../backend/temp/otpStore.js', () => ({}), { virtual: true });

const express   = require('express');
const supertest = require('supertest');
const { makeToken } = require('../helpers');
const { PatientAuth } = require('../../../../backend/services/db');
const router    = require('../../../../backend/routes/patient').default;
const aadhaarDB = require('../../../../backend/data/aadhaar_db.json');

const app = express();
app.use(express.json());
app.use('/patients', router);

const SECRET = process.env.AADHAAR_HASH_SECRET ?? 'dev-only-insecure-secret-change-in-prod';
const expectedHash = (aadhaarNumber) =>
  crypto.createHmac('sha256', SECRET).update(aadhaarNumber).digest('hex');

const [alice, bob] = aadhaarDB;
const doctorToken = makeToken('doctor', 'DOC_BIO_1');
const post = (body, token = doctorToken) => {
  const req = supertest(app).post('/patients/resolve-biometric');
  if (token) req.set('Authorization', `Bearer ${token}`);
  return req.send(body);
};

beforeEach(() => {
  PatientAuth.findOne.mockReset();
});

describe('POST /patients/resolve-biometric', () => {
  test('no token -> 401, nothing is looked up', async () => {
    const res = await post({ fingerprintTemplate: alice.fingerprintTemplate }, null);
    expect(res.status).toBe(401);
    expect(PatientAuth.findOne).not.toHaveBeenCalled();
  });

  test('missing fingerprintTemplate -> 400, nothing is looked up', async () => {
    const res = await post({});
    expect(res.status).toBe(400);
    expect(res.body.status).toBe('FAILED');
    expect(PatientAuth.findOne).not.toHaveBeenCalled();
  });

  test('a template unknown to UIDAI -> 400 and no patient lookup', async () => {
    const res = await post({ fingerprintTemplate: 'FP_TEMPLATE_DOES_NOT_EXIST' });
    expect(res.status).toBe(400);
    expect(res.body.status).toBe('FAILED');
    expect(PatientAuth.findOne).not.toHaveBeenCalled();
  });

  test('a known template for a registered patient -> 200 with patientID and fullName', async () => {
    PatientAuth.findOne.mockResolvedValue({ patientID: 'PAT_BIO_ALICE' });
    const res = await post({ fingerprintTemplate: alice.fingerprintTemplate });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'SUCCESS', patientID: 'PAT_BIO_ALICE', fullName: alice.fullName });
  });

  test('the lookup is by the HMAC of the Aadhaar number', async () => {
    PatientAuth.findOne.mockResolvedValue({ patientID: 'PAT_BIO_ALICE' });
    await post({ fingerprintTemplate: alice.fingerprintTemplate });
    expect(PatientAuth.findOne).toHaveBeenCalledTimes(1);
    expect(PatientAuth.findOne).toHaveBeenCalledWith({ aadhaarHash: expectedHash(alice.aadhaarNumber) });
  });

  test('the response never exposes the aadhaarHash or the raw Aadhaar number', async () => {
    PatientAuth.findOne.mockResolvedValue({ patientID: 'PAT_BIO_ALICE' });
    const res = await post({ fingerprintTemplate: alice.fingerprintTemplate });
    const raw = JSON.stringify(res.body);
    expect(raw).not.toContain(alice.aadhaarNumber);
    expect(raw).not.toContain(expectedHash(alice.aadhaarNumber));
    expect(res.body).not.toHaveProperty('aadhaarHash');
    expect(res.body).not.toHaveProperty('aadhaarNumber');
  });

  test('a verified identity with no registered patient -> 404, no patientID returned', async () => {
    PatientAuth.findOne.mockResolvedValue(null);
    const res = await post({ fingerprintTemplate: bob.fingerprintTemplate });
    expect(res.status).toBe(404);
    expect(res.body.status).toBe('FAILED');
    expect(res.body).not.toHaveProperty('patientID');
  });

  test('different templates are looked up under different hashes', async () => {
    PatientAuth.findOne.mockResolvedValue(null);
    await post({ fingerprintTemplate: alice.fingerprintTemplate });
    await post({ fingerprintTemplate: bob.fingerprintTemplate });
    const [first, second] = PatientAuth.findOne.mock.calls.map(([q]) => q.aadhaarHash);
    expect(first).toBe(expectedHash(alice.aadhaarNumber));
    expect(second).toBe(expectedHash(bob.aadhaarNumber));
    expect(first).not.toBe(second);
  });
});
