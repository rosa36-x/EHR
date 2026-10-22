/**
 * unit/emergencyRelationshipGuard.test.js
 *
 * Runs the REAL treatmentRelationshipFabricService.js against a mocked ledger
 * to check that an ASSIGNED_EMERGENCY_PHYSICIAN relationship can only be ended
 * by closing the emergency access:
 *   - discharge / mark dormant / reactivate through the normal path are refused
 *     for an emergency relationship, even for the doctor who owns it, and
 *     nothing is written to the ledger
 *   - the internal close path (dischargePatient with skipOwnershipCheck) still
 *     works, so closing or expiring an emergency access is not blocked
 *   - every other relationship type behaves exactly as before
 *   - a different doctor is still refused
 */

'use strict';

jest.mock('../../../../backend/services/fabricService',       () => require('../__mocks__/fabricService'));
jest.mock('../../../../backend/services/notificationService', () => require('../__mocks__/notificationService'));
jest.mock('../../../../backend/services/idService',           () => ({ generateID: () => 'TR_GUARD_0001' }));
jest.mock('../../../../backend/services/db', () => ({
  PatientAuth: { findOne: jest.fn() },
  Doctor:      { findOne: jest.fn() },
}));

const fabric = require('../../../../backend/services/fabricService');
const notif  = require('../../../../backend/services/notificationService');
const db     = require('../../../../backend/services/db');
const svc    = require('../../../../backend/services/treatmentRelationshipFabricService');

const contract = fabric.__contract;
const DOCTOR  = 'DOC_G1';
const PATIENT = 'PAT_G1';
const TR      = 'TR_G1';
const EMERGENCY = 'ASSIGNED_EMERGENCY_PHYSICIAN';

const stored = (over = {}) => Buffer.from(JSON.stringify({
  relationshipID: TR, patientID: PATIENT, doctorID: DOCTOR,
  relationshipType: 'RECENT_APPOINTMENT', status: 'ACTIVE',
  dormantAfter: new Date(Date.now() + 86400000).toISOString(), ...over,
}));
const mockStored = (over) =>
  contract.evaluateTransaction.mockImplementation(async (fn) => (fn === 'GetTreatmentRelationship' ? stored(over) : Buffer.from('')));
const submitted = () => contract.submitTransaction.mock.calls;

const normalPath = {
  discharge:  () => svc.dischargePatient(TR, DOCTOR),
  dormant:    () => svc.markDormant(TR, DOCTOR),
  reactivate: () => svc.reactivateTreatmentRelationship(TR, DOCTOR),
};

beforeEach(() => {
  jest.clearAllMocks();
  contract.submitTransaction.mockImplementation(async () => Buffer.from(''));
  db.PatientAuth.findOne.mockResolvedValue({ patientID: PATIENT, phone: '9000000000' });
  db.Doctor.findOne.mockResolvedValue({ doctorID: DOCTOR, fullName: 'Test Doc' });
});

describe('emergency relationship cannot be ended through the normal path', () => {
  test.each(Object.keys(normalPath))('%s by the owning doctor -> ACCESS_DENIED, nothing written', async (name) => {
    // DORMANT so that, without the guard, reactivate would also have succeeded
    mockStored({ relationshipType: EMERGENCY, status: 'DORMANT' });
    const r = await normalPath[name]();
    expect(r.status).toBe('ACCESS_DENIED');
    expect(r.message).toMatch(/closing the emergency access/i);
    expect(submitted()).toHaveLength(0);
  });

  test.each(Object.keys(normalPath))('%s by a different doctor is still ACCESS_DENIED', async (name) => {
    mockStored({ relationshipType: EMERGENCY, status: 'ACTIVE', doctorID: 'DOC_OTHER' });
    const r = await normalPath[name]();
    expect(r.status).toBe('ACCESS_DENIED');
    expect(submitted()).toHaveLength(0);
  });
});

describe('closing or expiring an emergency access still works', () => {
  test('dischargePatient with skipOwnershipCheck discharges an emergency relationship', async () => {
    mockStored({ relationshipType: EMERGENCY, status: 'ACTIVE' });
    const r = await svc.dischargePatient(TR, DOCTOR, true);
    expect(r.status).toBe('SUCCESS');
    expect(submitted()).toHaveLength(1);
    expect(submitted()[0].slice(0, 3)).toEqual(['UpdateTreatmentRelationshipStatus', TR, 'DISCHARGED']);
  });

  test('skipOwnershipCheck also covers an episode whose doctor id is passed from the log', async () => {
    mockStored({ relationshipType: EMERGENCY, status: 'ACTIVE', doctorID: DOCTOR });
    const r = await svc.dischargePatient(TR, 'ANY_CALLER', true);
    expect(r.status).toBe('SUCCESS');
  });
});

describe('dischargePatient notifyPatient option', () => {
  test('by default the patient is told the relationship ended', async () => {
    mockStored({ status: 'ACTIVE' });
    await svc.dischargePatient(TR, DOCTOR);
    expect(notif.notify).toHaveBeenCalledTimes(1);
    expect(notif.notify).toHaveBeenCalledWith(expect.objectContaining({
      event: 'TREATMENT_RELATIONSHIP_ENDED', recipientID: PATIENT,
    }));
  });

  test('notifyPatient:false discharges without sending anything', async () => {
    mockStored({ relationshipType: EMERGENCY, status: 'ACTIVE' });
    const r = await svc.dischargePatient(TR, DOCTOR, true, { notifyPatient: false });
    expect(r.status).toBe('SUCCESS');
    expect(submitted()[0].slice(0, 3)).toEqual(['UpdateTreatmentRelationshipStatus', TR, 'DISCHARGED']);
    expect(notif.notify).not.toHaveBeenCalled();
  });

  test('passing the option does not bypass the ownership check or the emergency guard', async () => {
    mockStored({ relationshipType: EMERGENCY, status: 'ACTIVE' });
    const r = await svc.dischargePatient(TR, DOCTOR, false, { notifyPatient: false });
    expect(r.status).toBe('ACCESS_DENIED');
    expect(submitted()).toHaveLength(0);
  });
});

describe('other relationship types are unaffected', () => {
  test.each([
    'RECENT_APPOINTMENT', 'FOLLOW_UP_CHECKUP', 'ONGOING_TREATMENT', 'REFERRED_BY_DOCTOR',
  ])('%s: discharge works', async (type) => {
    mockStored({ relationshipType: type, status: 'ACTIVE' });
    const r = await svc.dischargePatient(TR, DOCTOR);
    expect(r.status).toBe('SUCCESS');
    expect(submitted()[0].slice(0, 3)).toEqual(['UpdateTreatmentRelationshipStatus', TR, 'DISCHARGED']);
  });

  test('mark dormant works', async () => {
    mockStored({ relationshipType: 'ONGOING_TREATMENT', status: 'ACTIVE' });
    const r = await svc.markDormant(TR, DOCTOR);
    expect(r.status).toBe('SUCCESS');
    expect(submitted()[0].slice(0, 3)).toEqual(['UpdateTreatmentRelationshipStatus', TR, 'DORMANT']);
  });

  test('a dormant relationship can still be re-requested (PENDING)', async () => {
    mockStored({ relationshipType: 'FOLLOW_UP_CHECKUP', status: 'DORMANT' });
    const r = await svc.reactivateTreatmentRelationship(TR, DOCTOR);
    expect(r.status).toBe('SUCCESS');
    expect(r.relationshipStatus).toBe('PENDING');
  });

  test('a record with no relationshipType (older data) is treated as non-emergency', async () => {
    mockStored({ relationshipType: undefined, status: 'ACTIVE' });
    const r = await svc.dischargePatient(TR, DOCTOR);
    expect(r.status).toBe('SUCCESS');
  });
});
