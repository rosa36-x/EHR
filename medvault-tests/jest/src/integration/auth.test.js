/**
 * integration/auth.test.js
 *
 * Tests the full auth flow against the running Express app with
 * Fabric, IPFS, and notification services mocked at the module level.
 *
 * Mocked:  fabricService, ipfsService, kmsService, notificationService
 * Real:    Express routes, authMiddleware, authService, MongoDB
 *
 * Prerequisites:
 *   - MongoDB reachable at MONGODB_URI (defaults to localhost:27017/medvault_test)
 *   - backend/.env loaded (or env vars set)
 */

'use strict';

jest.mock('../../../../backend/services/fabricService',     () => require('../__mocks__/fabricService'));
jest.mock('../../../../backend/services/ipfsService',       () => require('../__mocks__/ipfsService'));
jest.mock('../../../../backend/services/kmsService',        () => require('../__mocks__/kmsService'));
jest.mock('../../../../backend/services/notificationService', () => require('../__mocks__/notificationService'));

const supertest = require('supertest');
const app       = require('../../../../backend/server');
const notify    = require('../../../../backend/services/notificationService');

// Override MongoDB to test DB — avoids polluting dev data
process.env.MONGODB_URI = process.env.MONGODB_URI_TEST || 'mongodb://localhost:27017/medvault_test';

const DOCTOR = {
  fullName:       'Dr. Test Auth',
  licenseNumber:  'NMC_TEST_AUTH_001',
  specialization: 'General Medicine',
  hospitalID:     'HOSP001',
  phone:          '9100000001',
  email:          'testauth@hospital.test',
  password:       'SecurePass@123',
};

let doctorID;

// ── helpers ────────────────────────────────────────────────────────────────────
function extractOTPFromMockCalls() {
  // In test mode notificationService.sendSMS is mocked.
  // The OTP is passed as the second argument to sendSMS.
  const calls = notify.sendSMS.mock.calls;
  if (!calls.length) return null;
  const message = calls[calls.length - 1][1];
  const match   = message.match(/\b(\d{6})\b/);
  return match ? match[1] : null;
}

afterEach(() => {
  notify.__clearCalls();
});

// ── Doctor registration ────────────────────────────────────────────────────────
describe('Doctor registration', () => {
  test('POST /doctors/register → 200, doctorID returned', async () => {
    const res = await supertest(app)
      .post('/doctors/register')
      .send(DOCTOR);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('SUCCESS');
    expect(res.body.doctorID).toMatch(/^DOC/);
    doctorID = res.body.doctorID;
  });

  test('duplicate registration → 400', async () => {
    const res = await supertest(app)
      .post('/doctors/register')
      .send(DOCTOR);

    expect(res.status).toBe(400);
    expect(res.body.status).toBe('FAILED');
  });

  test('missing required fields → 400', async () => {
    const res = await supertest(app)
      .post('/doctors/register')
      .send({ fullName: 'Incomplete Doctor' }); // missing everything else

    expect(res.status).toBe(400);
    expect(res.body.status).toBe('FAILED');
  });
});

// ── Doctor password login ──────────────────────────────────────────────────────
describe('Doctor login — password', () => {
  test('correct credentials → 200, JWT returned', async () => {
    const res = await supertest(app)
      .post('/auth/doctor/login')
      .send({ phone: DOCTOR.phone, password: DOCTOR.password });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('SUCCESS');
    expect(res.body.token.split('.')).toHaveLength(3);
    expect(res.body.doctorID).toBe(doctorID);
  });

  test('wrong password → 401', async () => {
    const res = await supertest(app)
      .post('/auth/doctor/login')
      .send({ phone: DOCTOR.phone, password: 'WrongPassword999' });

    expect(res.status).toBe(401);
    expect(res.body.token).toBeUndefined();
  });

  test('unknown phone → 401', async () => {
    const res = await supertest(app)
      .post('/auth/doctor/login')
      .send({ phone: '0000000000', password: DOCTOR.password });

    expect(res.status).toBe(401);
  });
});

// ── Doctor OTP login ───────────────────────────────────────────────────────────
describe('Doctor login — OTP', () => {
  let validOTP;

  test('POST /auth/doctor/otp/initiate → 200, SMS mock called', async () => {
    const res = await supertest(app)
      .post('/auth/doctor/otp/initiate')
      .send({ phone: DOCTOR.phone });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('OTP_SENT');
    expect(notify.sendSMS).toHaveBeenCalledTimes(1);
    validOTP = extractOTPFromMockCalls();
    expect(validOTP).toMatch(/^\d{6}$/);
  });

  test('POST /auth/doctor/otp/verify with correct OTP → 200, JWT returned', async () => {
    const res = await supertest(app)
      .post('/auth/doctor/otp/verify')
      .send({ phone: DOCTOR.phone, otp: validOTP });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('SUCCESS');
    expect(res.body.token.split('.')).toHaveLength(3);
  });

  test('wrong OTP → 401', async () => {
    // Re-initiate to get a fresh OTP in the store
    await supertest(app)
      .post('/auth/doctor/otp/initiate')
      .send({ phone: DOCTOR.phone });

    const res = await supertest(app)
      .post('/auth/doctor/otp/verify')
      .send({ phone: DOCTOR.phone, otp: '000000' });

    expect(res.status).toBe(401);
    expect(res.body.status).toBe('FAILED');
  });

  test('OTP replay (same OTP twice) → second call rejected', async () => {
    await supertest(app)
      .post('/auth/doctor/otp/initiate')
      .send({ phone: DOCTOR.phone });

    const otp = extractOTPFromMockCalls();

    await supertest(app)
      .post('/auth/doctor/otp/verify')
      .send({ phone: DOCTOR.phone, otp });

    // Second use of same OTP
    const res2 = await supertest(app)
      .post('/auth/doctor/otp/verify')
      .send({ phone: DOCTOR.phone, otp });

    expect(res2.status).toBe(401);
  });
});
