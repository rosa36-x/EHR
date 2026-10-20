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
 *   - an episode that fails to set up is marked ABORTED on the ledger, and
 *     closing one marks it CLOSED (best-effort, never fails the request)
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
const ledgerUpdates = () =>
  contract.submitTransaction.mock.calls.filter((c) => c[0] === 'UpdateEmergencyAccessStatus');

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
    expect(ledgerUpdates()).toHaveLength(1);
    expect(ledgerUpdates()[0].slice(1, 3)).toEqual(['EA_UNIT_0001', 'ABORTED']);
  });

  test('log write fails -> relationship is discharged, FAILED, no patient SMS', async () => {
    db.EmergencyAccessLog.create.mockRejectedValue(new Error('mongo down'));
    const r = await svc.createEmergencyAccess(input, DOCTOR);
    expect(r.status).toBe('FAILED');
    expect(trSvc.dischargePatient).toHaveBeenCalledWith('TR_E1', DOCTOR, true);
    expect(notif.notify).not.toHaveBeenCalled();
    expect(ledgerUpdates()[0].slice(1, 3)).toEqual(['EA_UNIT_0001', 'ABORTED']);
  });

  test('success never touches the ledger status', async () => {
    await svc.createEmergencyAccess(input, DOCTOR);
    expect(ledgerUpdates()).toHaveLength(0);
  });

  test('ledger ABORTED update failing does not change the FAILED result', async () => {
    trSvc.createTreatmentRelationship.mockResolvedValue({ status: 'FAILED', message: 'boom' });
    contract.submitTransaction.mockImplementation(async (fn) => {
      if (fn === 'UpdateEmergencyAccessStatus') throw new Error('ledger down');
      return Buffer.from('');
    });
    const r = await svc.createEmergencyAccess(input, DOCTOR);
    expect(r.status).toBe('FAILED');
    expect(r.message).toBe('Failed to grant emergency access relationship.');
  });
});

describe('closeEmergencyAccess', () => {
  const makeLog = (over = {}) => ({
    emergencyAccessID: 'EA_C1', relationshipID: 'TR_C1', doctorID: DOCTOR, patientID: PATIENT,
    status: 'ACTIVE', save: jest.fn().mockResolvedValue(undefined), ...over,
  });

  test('success: relationship discharged, ledger marked CLOSED, log saved', async () => {
    const log = makeLog();
    db.EmergencyAccessLog.findOne.mockResolvedValue(log);
    const r = await svc.closeEmergencyAccess('EA_C1', DOCTOR, 'doctor');
    expect(r.status).toBe('SUCCESS');
    expect(trSvc.dischargePatient).toHaveBeenCalledWith('TR_C1', DOCTOR, true);
    expect(ledgerUpdates()).toHaveLength(1);
    expect(ledgerUpdates()[0].slice(1, 3)).toEqual(['EA_C1', 'CLOSED']);
    expect(log.status).toBe('CLOSED');
    expect(log.save).toHaveBeenCalled();
  });

  test('ledger CLOSED update failing still closes the episode', async () => {
    const log = makeLog();
    db.EmergencyAccessLog.findOne.mockResolvedValue(log);
    contract.submitTransaction.mockImplementation(async () => { throw new Error('ledger down'); });
    const r = await svc.closeEmergencyAccess('EA_C1', DOCTOR, 'doctor');
    expect(r.status).toBe('SUCCESS');
    expect(log.status).toBe('CLOSED');
    expect(log.save).toHaveBeenCalled();
  });

  test('discharge failure -> FAILED, ledger untouched, log stays ACTIVE', async () => {
    const log = makeLog();
    db.EmergencyAccessLog.findOne.mockResolvedValue(log);
    trSvc.dischargePatient.mockResolvedValue({ status: 'FAILED', message: 'nope' });
    const r = await svc.closeEmergencyAccess('EA_C1', DOCTOR, 'doctor');
    expect(r.status).toBe('FAILED');
    expect(ledgerUpdates()).toHaveLength(0);
    expect(log.status).toBe('ACTIVE');
  });

  test('another doctor -> ACCESS_DENIED, nothing changes', async () => {
    db.EmergencyAccessLog.findOne.mockResolvedValue(makeLog());
    const r = await svc.closeEmergencyAccess('EA_C1', 'DOC_OTHER', 'doctor');
    expect(r.status).toBe('ACCESS_DENIED');
    expect(trSvc.dischargePatient).not.toHaveBeenCalled();
    expect(ledgerUpdates()).toHaveLength(0);
  });

  test('already closed -> FAILED, nothing changes', async () => {
    db.EmergencyAccessLog.findOne.mockResolvedValue(makeLog({ status: 'CLOSED' }));
    const r = await svc.closeEmergencyAccess('EA_C1', DOCTOR, 'doctor');
    expect(r.status).toBe('FAILED');
    expect(trSvc.dischargePatient).not.toHaveBeenCalled();
    expect(ledgerUpdates()).toHaveLength(0);
  });
});

describe('getEmergencyAccess', () => {
  const makeLog = (over = {}) => ({ emergencyAccessID: 'EA_G1', relationshipID: 'TR_G1', doctorID: DOCTOR, patientID: PATIENT, status: 'ACTIVE', ...over });
  const evaluates = () => contract.evaluateTransaction.mock.calls.filter((c) => c[0] === 'GetEmergencyAccess');

  test('no Mongo log -> NOT_FOUND, ledger never read (fails closed)', async () => {
    db.EmergencyAccessLog.findOne.mockResolvedValue(null);
    const r = await svc.getEmergencyAccess('EA_G1', 'PAT_ANYONE', 'patient');
    expect(r.status).toBe('NOT_FOUND');
    expect(r.data).toBeUndefined();
    expect(evaluates()).toHaveLength(0);
  });

  test('opening doctor -> SUCCESS with ledger data', async () => {
    db.EmergencyAccessLog.findOne.mockResolvedValue(makeLog());
    const r = await svc.getEmergencyAccess('EA_G1', DOCTOR, 'doctor');
    expect(r.status).toBe('SUCCESS');
    expect(r.data.emergencyAccessID).toBe('EA_G1');
  });

  test('the patient it belongs to -> SUCCESS', async () => {
    db.EmergencyAccessLog.findOne.mockResolvedValue(makeLog());
    expect((await svc.getEmergencyAccess('EA_G1', PATIENT, 'patient')).status).toBe('SUCCESS');
  });

  test.each([
    ['another doctor',  'DOC_OTHER', 'doctor'],
    ['another patient', 'PAT_OTHER', 'patient'],
    ['an org actor',    'ORG_1',     'org_actor'],
  ])('%s -> ACCESS_DENIED, ledger never read', async (_n, id, role) => {
    db.EmergencyAccessLog.findOne.mockResolvedValue(makeLog());
    const r = await svc.getEmergencyAccess('EA_G1', id, role);
    expect(r.status).toBe('ACCESS_DENIED');
    expect(r.data).toBeUndefined();
    expect(evaluates()).toHaveLength(0);
  });

  test('ledger error -> FAILED with the error message', async () => {
    db.EmergencyAccessLog.findOne.mockResolvedValue(makeLog());
    contract.evaluateTransaction.mockRejectedValueOnce(new Error('chaincode response 500'));
    const r = await svc.getEmergencyAccess('EA_G1', DOCTOR, 'doctor');
    expect(r.status).toBe('FAILED');
    expect(r.message).toMatch(/chaincode response 500/);
  });
});

describe('closeEmergencyAccess - unknown id', () => {
  test('no log -> NOT_FOUND, nothing changes', async () => {
    db.EmergencyAccessLog.findOne.mockResolvedValue(null);
    const r = await svc.closeEmergencyAccess('EA_NOPE', DOCTOR, 'doctor');
    expect(r.status).toBe('NOT_FOUND');
    expect(trSvc.dischargePatient).not.toHaveBeenCalled();
  });
});
