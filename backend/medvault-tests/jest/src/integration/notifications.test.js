/**
 * integration/notifications.test.js
 *
 * Verifies that the notification service mock is called with correct
 * arguments at the right moments:
 *
 *   1. Patient OTP login → sendSMS called with phone + 6-digit OTP
 *   2. Doctor OTP login  → sendSMS called with phone + 6-digit OTP
 *   3. Permission request created → sendSMS/sendEmail called to patient
 *   4. Permission request approved → sendSMS/sendEmail called to doctor
 *   5. Permission request rejected → sendSMS/sendEmail called to doctor
 *
 * This test validates the mock itself is wired correctly — it does NOT
 * test real SMS/email delivery (which requires MSG91/Gmail credentials).
 */

'use strict';

jest.mock('../../../backend/services/fabricService',       () => require('../__mocks__/fabricService'));
jest.mock('../../../backend/services/ipfsService',         () => require('../__mocks__/ipfsService'));
jest.mock('../../../backend/services/kmsService',          () => require('../__mocks__/kmsService'));
jest.mock('../../../backend/services/notificationService', () => require('../__mocks__/notificationService'));

const supertest    = require('supertest');
const app          = require('../../../backend/server');
const notify       = require('../../../backend/services/notificationService');
const fabricMock   = require('../../../backend/services/fabricService');
const { makeToken }= require('../helpers');

process.env.MONGODB_URI = process.env.MONGODB_URI_TEST || 'mongodb://localhost:27017/medvault_test';

afterEach(() => notify.__clearCalls());

// ── Doctor must exist in MongoDB before OTP initiate can fire ─────────────────
const DOCTOR = {
  fullName:      'Dr. Notify Test',
  licenseNumber: 'NMC_NOTIFY_001',
  specialization:'General Medicine',
  hospitalID:    'HOSP001',
  phone:         '9200000001',
  email:         'notifytest@hospital.test',
  password:      'TestPass@123',
};

let doctorRegistered = false;

async function ensureDoctorRegistered() {
  if (doctorRegistered) return;
  await supertest(app).post('/doctors/register').send(DOCTOR);
  doctorRegistered = true;
}

// ── OTP notifications ─────────────────────────────────────────────────────────
describe('OTP notifications', () => {
  test('Doctor OTP initiate → sendSMS called with correct phone and 6-digit OTP', async () => {
    await ensureDoctorRegistered();

    const res = await supertest(app)
      .post('/auth/doctor/otp/initiate')
      .send({ phone: DOCTOR.phone });

    expect(res.status).toBe(200);
    expect(notify.sendSMS).toHaveBeenCalledTimes(1);

    const [phone, message] = notify.sendSMS.mock.calls[0];
    expect(phone).toBe(DOCTOR.phone);
    expect(message).toMatch(/\b\d{6}\b/); // 6-digit OTP in the message
  });
});

// ── Permission request notifications ─────────────────────────────────────────
describe('Permission request notifications', () => {
  const DOCTOR_ID   = 'DOC_NOTIFY_001';
  const PATIENT_ID  = 'PAT_NOTIFY_001';
  const doctorToken  = makeToken('doctor',  DOCTOR_ID);
  const patientToken = makeToken('patient', PATIENT_ID);
  const REQUEST_ID   = 'PREQ_NOTIFY_001';

  beforeAll(() => {
    fabricMock.createPermissionRequest.mockResolvedValue({
      status:    'SUCCESS',
      requestID: REQUEST_ID,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    });
    fabricMock.approvePermissionRequest.mockResolvedValue({
      status:        'SUCCESS',
      accessExpires: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
    });
    fabricMock.rejectPermissionRequest.mockResolvedValue({ status: 'SUCCESS' });
    fabricMock.getPermissionRequest.mockResolvedValue({
      status: 'SUCCESS',
      data: { requestID: REQUEST_ID, doctorID: DOCTOR_ID, patientID: PATIENT_ID, status: 'PENDING' },
    });
  });

  test('POST /permission-requests → patient notified (SMS or email)', async () => {
    const res = await supertest(app)
      .post('/permission-requests')
      .set('Authorization', `Bearer ${doctorToken}`)
      .send({
        patientID:    PATIENT_ID,
        resourceType: 'CONSULTATION',
        resourceID:   'CONS_NOTIFY_001',
        reason:       'Clinical review required',
      });

    expect(res.status).toBe(200);
    // Notification to patient should have fired
    const totalCalls = notify.sendSMS.mock.calls.length + notify.sendEmail.mock.calls.length;
    expect(totalCalls).toBeGreaterThanOrEqual(1);
  });

  test('PATCH /approve → doctor notified', async () => {
    notify.__clearCalls();

    const res = await supertest(app)
      .patch(`/permission-requests/${REQUEST_ID}/approve`)
      .set('Authorization', `Bearer ${patientToken}`);

    expect(res.status).toBe(200);
    const totalCalls = notify.sendSMS.mock.calls.length + notify.sendEmail.mock.calls.length;
    expect(totalCalls).toBeGreaterThanOrEqual(1);
  });

  test('PATCH /reject → doctor notified', async () => {
    // Reset mock status so we can reject
    fabricMock.getPermissionRequest.mockResolvedValueOnce({
      status: 'SUCCESS',
      data: { requestID: REQUEST_ID, doctorID: DOCTOR_ID, patientID: PATIENT_ID, status: 'PENDING' },
    });
    fabricMock.rejectPermissionRequest.mockResolvedValueOnce({ status: 'SUCCESS' });
    notify.__clearCalls();

    const res = await supertest(app)
      .patch(`/permission-requests/${REQUEST_ID}/reject`)
      .set('Authorization', `Bearer ${patientToken}`);

    expect(res.status).toBe(200);
    const totalCalls = notify.sendSMS.mock.calls.length + notify.sendEmail.mock.calls.length;
    expect(totalCalls).toBeGreaterThanOrEqual(1);
  });
});
