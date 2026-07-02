/**
 * integration/notifications.test.js
 *
 * Verifies that the notification service mock is called with correct
 * arguments at the right moments:
 *
 *   1. Doctor OTP login -> sendSMS called with phone + 6-digit OTP
 *   2. Permission request created -> sendSMS/sendEmail called to patient
 *   3. Permission request approved -> sendSMS/sendEmail called to doctor
 *   4. Permission request rejected -> sendSMS/sendEmail called to doctor
 *
 * The notify() calls inside permissionRequestFabricService.js only fire when
 * BOTH a Doctor and PatientAuth record exist in Mongo (it looks them up to
 * find phone numbers). So this test seeds real Mongo documents directly and
 * leaves permissionRequestFabricService UNMOCKED, letting its real logic
 * (including the notify() calls we're verifying) run. Only fabricService
 * (low-level Fabric boundary), ipfsService, kmsService, and
 * notificationService (the actual SMS/email transport) are mocked.
 *
 * This test validates real business logic triggers notifications correctly -
 * it does NOT test real SMS/email delivery (which requires MSG91/Gmail
 * credentials).
 */

'use strict';

jest.mock('../../../../backend/services/fabricService',       () => require('../__mocks__/fabricService'));
jest.mock('../../../../backend/services/ipfsService',         () => require('../__mocks__/ipfsService'));
jest.mock('../../../../backend/services/kmsService',          () => require('../__mocks__/kmsService'));
jest.mock('../../../../backend/services/notificationService', () => require('../__mocks__/notificationService'));

const supertest       = require('supertest');
const app             = require('../../../../backend/server');
const notify           = require('../../../../backend/services/notificationService');
const fabricMock       = require('../../../../backend/services/fabricService');
const { makeToken }   = require('../helpers');
const { PatientAuth, Doctor } = require('../../../../backend/services/db.js');

process.env.MONGODB_URI = process.env.MONGODB_URI_TEST || 'mongodb://localhost:27017/medvault_test';

afterEach(() => notify.__clearCalls());

// -- Doctor must exist in MongoDB before OTP initiate can fire ------------------
const DOCTOR = {
  fullName:       'Dr. Notify Test',
  licenseNumber:  'NMCNOTIFY001',
  specialization: 'General Medicine',
  hospitalID:     'HOSP001',
  phone:          '9200000001',
  email:          'notifytest@hospital.test',
  password:       'TestPass@123',
};

let doctorRegistered = false;

async function ensureDoctorRegistered() {
  if (doctorRegistered) return;
  await supertest(app).post('/doctors/register').send(DOCTOR);
  doctorRegistered = true;
}

// -- OTP notifications -----------------------------------------------------------
describe('OTP notifications', () => {
  test('Doctor OTP initiate -> sendSMS called with correct phone and 6-digit OTP', async () => {
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

// -- Permission request notifications --------------------------------------------
describe('Permission request notifications', () => {
  const DOCTOR_ID   = 'DOC_NOTIFY_001';
  const PATIENT_ID  = 'PAT_NOTIFY_001';
  const doctorToken  = makeToken('doctor',  DOCTOR_ID);
  const patientToken = makeToken('patient', PATIENT_ID);

  let firstRequestID;

  beforeAll(async () => {
    // Seed real Mongo docs so PatientAuth.findOne/Doctor.findOne inside the
    // real service succeed and notify() actually fires.
    await Doctor.findOneAndUpdate(
      { doctorID: DOCTOR_ID },
      {
        doctorID: DOCTOR_ID, fullName: 'Dr. Notify Recipient', licenseNumber: 'NMCNOTIFY002',
        specialization: 'General Medicine', hospitalID: 'HOSP001', phone: '9200000002',
        email: 'notifydoc@hospital.test', passwordHash: 'placeholder', isVerified: true,
        createdAt: new Date().toISOString(),
      },
      { upsert: true }
    );
    await PatientAuth.findOneAndUpdate(
      { patientID: PATIENT_ID },
      { patientID: PATIENT_ID, phone: '9300000002', createdAt: new Date().toISOString() },
      { upsert: true }
    );

    // approve/reject need GetPermissionRequest to resolve to a record whose
    // doctorID matches the Doctor we just seeded above.
    fabricMock.__contract.evaluateTransaction.mockImplementation(async (fnName, id) => {
      if (fnName === 'GetPermissionRequest') {
        return Buffer.from(JSON.stringify({
          requestID: id, status: 'PENDING', doctorID: DOCTOR_ID, patientID: PATIENT_ID,
          resourceType: 'CONSULTATION', resourceID: 'CONS_NOTIFY_001',
        }));
      }
      return Buffer.from('{}');
    });
  });

  test('POST /permission-requests -> patient notified (SMS or email)', async () => {
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
    firstRequestID = res.body.requestID;

    const totalCalls = notify.sendSMS.mock.calls.length + notify.sendEmail.mock.calls.length;
    expect(totalCalls).toBeGreaterThanOrEqual(1);
  });

  test('PATCH /approve -> doctor notified', async () => {
    notify.__clearCalls();

    const res = await supertest(app)
      .patch(`/permission-requests/${firstRequestID}/approve`)
      .set('Authorization', `Bearer ${patientToken}`);

    expect(res.status).toBe(200);
    const totalCalls = notify.sendSMS.mock.calls.length + notify.sendEmail.mock.calls.length;
    expect(totalCalls).toBeGreaterThanOrEqual(1);
  });

  test('PATCH /reject -> doctor notified', async () => {
    // The first request is already APPROVED - create a fresh PENDING one to reject.
    const createRes = await supertest(app)
      .post('/permission-requests')
      .set('Authorization', `Bearer ${doctorToken}`)
      .send({
        patientID:    PATIENT_ID,
        resourceType: 'CONSULTATION',
        resourceID:   'CONS_NOTIFY_002',
        reason:       'Second clinical review',
      });
    const secondRequestID = createRes.body.requestID;
    notify.__clearCalls();

    const res = await supertest(app)
      .patch(`/permission-requests/${secondRequestID}/reject`)
      .set('Authorization', `Bearer ${patientToken}`);

    expect(res.status).toBe(200);
    const totalCalls = notify.sendSMS.mock.calls.length + notify.sendEmail.mock.calls.length;
    expect(totalCalls).toBeGreaterThanOrEqual(1);
  });
});
