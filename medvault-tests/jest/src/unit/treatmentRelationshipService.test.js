/**
 * unit/treatmentRelationshipService.test.js
 *
 * Runs the REAL treatmentRelationshipFabricService.js against a mocked ledger
 * (fabricService mock), mocked Mongo models and mocked notifications, to
 * check the patient-approval rules:
 *   - a doctor-created relationship is submitted PENDING, never ACTIVE
 *   - ASSIGNED_EMERGENCY_PHYSICIAN is refused unless the emergency path opts out
 *   - only the owning patient can approve / reject, and only from PENDING
 *   - reactivation by the doctor only re-requests (PENDING), never activates
 */

'use strict';

jest.mock('../../../../backend/services/fabricService',     () => require('../__mocks__/fabricService'));
jest.mock('../../../../backend/services/notificationService', () => require('../__mocks__/notificationService'));
jest.mock('../../../../backend/services/idService',          () => ({ generateID: () => 'TR_UNIT_0001' }));
jest.mock('../../../../backend/services/db', () => ({
  PatientAuth: { findOne: jest.fn() },
  Doctor:      { findOne: jest.fn() },
}));

const fabric = require('../../../../backend/services/fabricService');
const notif  = require('../../../../backend/services/notificationService');
const db     = require('../../../../backend/services/db');
const svc    = require('../../../../backend/services/treatmentRelationshipFabricService');

const contract = fabric.__contract;
const DOCTOR  = 'DOC_U1';
const PATIENT = 'PAT_U1';
const TR      = 'TR_U1';

const stored = (over = {}) => Buffer.from(JSON.stringify({
  relationshipID: TR, patientID: PATIENT, doctorID: DOCTOR,
  status: 'PENDING', dormantAfter: new Date(Date.now() + 86400000).toISOString(), ...over,
}));
const mockStored = (over) =>
  contract.evaluateTransaction.mockImplementation(async (fn) => (fn === 'GetTreatmentRelationship' ? stored(over) : Buffer.from('')));
const submitted = () => contract.submitTransaction.mock.calls;

beforeEach(() => {
  jest.clearAllMocks();
  contract.submitTransaction.mockImplementation(async () => Buffer.from(''));
  db.PatientAuth.findOne.mockResolvedValue({ patientID: PATIENT, phone: '9000000000' });
  db.Doctor.findOne.mockResolvedValue({ doctorID: DOCTOR, fullName: 'Test Doc' });
});

describe('createTreatmentRelationship', () => {
  const data = { patientID: PATIENT, doctorID: DOCTOR, relationshipType: 'RECENT_APPOINTMENT' };

  test('default: submitted PENDING and the patient is notified', async () => {
    const r = await svc.createTreatmentRelationship(data);
    expect(r.status).toBe('SUCCESS');
    expect(r.relationshipStatus).toBe('PENDING');
    expect(r.requiresPatientApproval).toBe(true);
    const [fn, , , , , , status] = submitted()[0];
    expect(fn).toBe('CreateTreatmentRelationship');
    expect(status).toBe('PENDING');
    expect(notif.notify).toHaveBeenCalledWith(expect.objectContaining({ event: 'TREATMENT_RELATIONSHIP_REQUEST', recipientID: PATIENT }));
  });

  test('emergency type is refused on the default (doctor) path, nothing submitted', async () => {
    const r = await svc.createTreatmentRelationship({ ...data, relationshipType: 'ASSIGNED_EMERGENCY_PHYSICIAN' });
    expect(r.status).toBe('ACCESS_DENIED');
    expect(submitted()).toHaveLength(0);
  });

  test('unknown patient -> FAILED, nothing submitted', async () => {
    db.PatientAuth.findOne.mockResolvedValue(null);
    const r = await svc.createTreatmentRelationship(data);
    expect(r.status).toBe('FAILED');
    expect(submitted()).toHaveLength(0);
  });

  test('emergency path (requirePatientApproval:false) is ACTIVE immediately, no approval SMS', async () => {
    const r = await svc.createTreatmentRelationship(
      { ...data, relationshipType: 'ASSIGNED_EMERGENCY_PHYSICIAN', dormantAfterHours: 24 },
      { requirePatientApproval: false },
    );
    expect(r.status).toBe('SUCCESS');
    expect(submitted()[0][6]).toBe('ACTIVE');
    expect(notif.notify).not.toHaveBeenCalled();
  });
});

describe('approve / reject', () => {
  test('owning patient approves PENDING -> ReactivateTreatmentRelationship', async () => {
    mockStored({ status: 'PENDING' });
    const r = await svc.approveTreatmentRelationship(TR, PATIENT);
    expect(r.status).toBe('SUCCESS');
    expect(submitted()[0][0]).toBe('ReactivateTreatmentRelationship');
  });

  test('another patient cannot approve', async () => {
    mockStored({ status: 'PENDING' });
    const r = await svc.approveTreatmentRelationship(TR, 'PAT_OTHER');
    expect(r.status).toBe('ACCESS_DENIED');
    expect(submitted()).toHaveLength(0);
  });

  test.each(['ACTIVE', 'DORMANT', 'DISCHARGED'])('cannot approve a %s relationship', async (st) => {
    mockStored({ status: st });
    const r = await svc.approveTreatmentRelationship(TR, PATIENT);
    expect(r.status).toBe('FAILED');
    expect(submitted()).toHaveLength(0);
  });

  test('reject PENDING -> DISCHARGED; other patient denied', async () => {
    mockStored({ status: 'PENDING' });
    expect((await svc.rejectTreatmentRelationship(TR, 'PAT_OTHER')).status).toBe('ACCESS_DENIED');
    expect(submitted()).toHaveLength(0);

    const r = await svc.rejectTreatmentRelationship(TR, PATIENT);
    expect(r.status).toBe('SUCCESS');
    expect(submitted()[0].slice(0, 3)).toEqual(['UpdateTreatmentRelationshipStatus', TR, 'DISCHARGED']);
  });
});

describe('doctor reactivation only re-requests', () => {
  test('DORMANT -> PENDING (never ACTIVE), patient notified', async () => {
    mockStored({ status: 'DORMANT' });
    const r = await svc.reactivateTreatmentRelationship(TR, DOCTOR);
    expect(r.status).toBe('SUCCESS');
    expect(r.relationshipStatus).toBe('PENDING');
    expect(submitted()[0].slice(0, 3)).toEqual(['UpdateTreatmentRelationshipStatus', TR, 'PENDING']);
    expect(notif.notify).toHaveBeenCalledWith(expect.objectContaining({ event: 'TREATMENT_RELATIONSHIP_RENEWAL_REQUEST' }));
  });

  test('ACTIVE but past dormantAfter counts as lapsed', async () => {
    mockStored({ status: 'ACTIVE', dormantAfter: new Date(Date.now() - 1000).toISOString() });
    expect((await svc.reactivateTreatmentRelationship(TR, DOCTOR)).status).toBe('SUCCESS');
  });

  test.each([
    ['ACTIVE', 86400000],
    ['PENDING', 86400000],
    ['DISCHARGED', -1000],
  ])('%s relationship cannot be reactivated', async (st, offset) => {
    mockStored({ status: st, dormantAfter: new Date(Date.now() + offset).toISOString() });
    const r = await svc.reactivateTreatmentRelationship(TR, DOCTOR);
    expect(r.status).toBe('FAILED');
    expect(submitted()).toHaveLength(0);
  });

  test('a different doctor is denied', async () => {
    mockStored({ status: 'DORMANT' });
    expect((await svc.reactivateTreatmentRelationship(TR, 'DOC_OTHER')).status).toBe('ACCESS_DENIED');
    expect(submitted()).toHaveLength(0);
  });
});
