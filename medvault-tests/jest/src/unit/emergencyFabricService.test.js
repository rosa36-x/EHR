/**
 * unit/emergencyFabricService.test.js
 *
 * Runs the REAL emergencyFabricService.js against a mocked ledger, mocked
 * Mongo models and a mocked treatment-relationship service, to check that:
 *   - the patient must exist before anything is written
 *   - the ledger status is always ACTIVE, whatever the caller passes
 *   - the backing relationship is created through the emergency path
 *     ({ requirePatientApproval: false })
 *   - a failed EmergencyAccessLog write revokes the relationship instead of
 *     leaving an access nobody can close
 */

'use strict';

jest.mock('../../../../backend/services/fabricService',     () => require('../__mocks__/fabricService'));
jest.mock('../../../../backend/services/notificationService', () => require('../__mocks__/notificationService'));
jest.mock('../../../../backend/services/auditMiddleware',   () => ({ logAudit: jest.fn() }));
jest.mock('../../../../backend/services/idService',         () => ({ generateID: () => 'EA_UNIT_0001' }));
jest.mock('../../../../backend/services/treatmentRelationshipFabricService', () => ({
  createTreatmentRelationship: jest.fn(),
  dischargePatient:            jest.fn(),
}));
jest.mock('../../../../backend/services/db', () => ({
  PatientAuth:        { findOne: jest.fn() },
  Doctor:             { findOne: jest.fn() },
  EmergencyAccessLog: { findOne: jest.fn(), create: jest.fn() },
}));

const fabric = require('../../../../backend/services/fabricService');
const notif  = require('../../../../backend/services/notificationService');
const db     = require('../../../../backend/services/db');
const trSvc  = require('../../../../backend/services/treatmentRelationshipFabricService');
const svc    = require('../../../../backend/services/emergencyFabricService');

const contract = fabric.__contract;
const DOCTOR  = 'DOC_E1';
const PATIENT = 'PAT_E1';
const REASON  = 'Patient unconscious, needs immediate treatment';
const input   = { patientID: PATIENT, doctorID: DOCTOR, reason: REASON };

beforeEach(() => {
  jest.clearAllMocks();
  contract.submitTransaction.mockImplementation(async () => Buffer.from(''));
  db.PatientAuth.findOne.mockResolvedValue({ patientID: PATIENT, phone: '9000000000' });
  db.Doctor.findOne.mockResolvedValue({ doctorID: DOCTOR, fullName: 'Test Doc' });
  db.EmergencyAccessLog.findOne.mockResolvedValue(null);
  db.EmergencyAccessLog.create.mockResolvedValue({});
  trSvc.createTreatmentRelationship.mockResolvedValue({
    status: 'SUCCESS', relationshipID: 'TR_E1', dormantAfter: new Date(Date.now() + 86400000).toISOString(),
  });
  trSvc.dischargePatient.mockResolvedValue({ status: 'SUCCESS' });
});

describe('createEmergencyAccess', () => {
  test('unknown patient -> NOT_FOUND, nothing written', async () => {
    db.PatientAuth.findOne.mockResolvedValue(null);
    const r = await svc.createEmergencyAccess(input, DOCTOR);
    expect(r.status).toBe('NOT_FOUND');
    expect(contract.submitTransaction).not.toHaveBeenCalled();
    expect(trSvc.createTreatmentRelationship).not.toHaveBeenCalled();
    expect(db.EmergencyAccessLog.create).not.toHaveBeenCalled();
  });

  test('ledger status is always ACTIVE, even if the caller passes another', async () => {
    const r = await svc.createEmergencyAccess({ ...input, status: 'CLOSED' }, DOCTOR);
    expect(r.status).toBe('SUCCESS');
    const [fn, , , , , status] = contract.submitTransaction.mock.calls[0];
    expect(fn).toBe('CreateEmergencyAccess');
    expect(status).toBe('ACTIVE');
  });

  test('backing relationship uses the emergency path and a 24h ceiling', async () => {
    await svc.createEmergencyAccess(input, DOCTOR);
    const [rel, opts] = trSvc.createTreatmentRelationship.mock.calls[0];
    expect(rel).toEqual(expect.objectContaining({
      patientID: PATIENT, doctorID: DOCTOR,
      relationshipType: 'ASSIGNED_EMERGENCY_PHYSICIAN', dormantAfterHours: 24,
    }));
    expect(opts).toEqual({ requirePatientApproval: false });
    expect(notif.notify).toHaveBeenCalledWith(expect.objectContaining({ event: 'EMERGENCY_ACCESS', recipientID: PATIENT }));
  });

  test('existing active episode -> FAILED, no ledger write', async () => {
    db.EmergencyAccessLog.findOne.mockResolvedValue({ createdAt: 'x', expiresAt: 'y' });
    const r = await svc.createEmergencyAccess(input, DOCTOR);
    expect(r.status).toBe('FAILED');
    expect(r.message).toMatch(/already have active/);
    expect(contract.submitTransaction).not.toHaveBeenCalled();
  });

  test('relationship creation fails -> FAILED, no log written', async () => {
    trSvc.createTreatmentRelationship.mockResolvedValue({ status: 'FAILED', message: 'boom' });
    const r = await svc.createEmergencyAccess(input, DOCTOR);
    expect(r.status).toBe('FAILED');
    expect(db.EmergencyAccessLog.create).not.toHaveBeenCalled();
    expect(trSvc.dischargePatient).not.toHaveBeenCalled();
  });

  test('log write fails -> relationship is discharged, FAILED, no patient SMS', async () => {
    db.EmergencyAccessLog.create.mockRejectedValue(new Error('mongo down'));
    const r = await svc.createEmergencyAccess(input, DOCTOR);
    expect(r.status).toBe('FAILED');
    expect(trSvc.dischargePatient).toHaveBeenCalledWith('TR_E1', DOCTOR, true);
    expect(notif.notify).not.toHaveBeenCalled();
  });
});
