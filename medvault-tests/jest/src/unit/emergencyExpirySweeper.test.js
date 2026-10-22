/**
 * unit/emergencyExpirySweeper.test.js
 *
 * Runs the REAL emergencyFabricService.js against a mocked ledger, mocked
 * Mongo models and a mocked treatment-relationship service, to check:
 *
 * listActiveEmergencyAccess
 *   - queries only the caller's own ACTIVE, unexpired episodes, newest first
 *   - returns only the documented fields (nothing else from the stored row)
 *   - a database error becomes FAILED, not a throw
 *
 * expireStaleEmergencyAccess
 *   - only ACTIVE episodes whose expiresAt has passed are selected
 *   - each one: relationship discharged (ownership check skipped), ledger marked
 *     CLOSED, log CLOSED by "system", audit entry written, patient notified
 *   - a failed discharge leaves that episode untouched and the sweep carries on
 *   - an unexpected error on one episode does not stop the others
 *   - the result counts scanned / closed / failed
 */

'use strict';

jest.mock('../../../../backend/services/fabricService',       () => require('../__mocks__/fabricService'));
jest.mock('../../../../backend/services/notificationService', () => require('../__mocks__/notificationService'));
jest.mock('../../../../backend/services/auditMiddleware',     () => ({ logAudit: jest.fn() }));
jest.mock('../../../../backend/services/idService',           () => ({ generateID: () => 'EA_SWEEP_0001' }));
jest.mock('../../../../backend/services/treatmentRelationshipFabricService', () => ({
  createTreatmentRelationship: jest.fn(),
  dischargePatient:            jest.fn(),
}));
jest.mock('../../../../backend/services/db', () => ({
  PatientAuth:        { findOne: jest.fn() },
  Doctor:             { findOne: jest.fn() },
  EmergencyAccessLog: { find: jest.fn(), findOne: jest.fn(), create: jest.fn() },
}));

const fabric = require('../../../../backend/services/fabricService');
const notif  = require('../../../../backend/services/notificationService');
const audit  = require('../../../../backend/services/auditMiddleware');
const db     = require('../../../../backend/services/db');
const trSvc  = require('../../../../backend/services/treatmentRelationshipFabricService');
const svc    = require('../../../../backend/services/emergencyFabricService');

const contract = fabric.__contract;
const DOCTOR  = 'DOC_S1';
const PATIENT = 'PAT_S1';

const ledgerUpdates = () =>
  contract.submitTransaction.mock.calls.filter((c) => c[0] === 'UpdateEmergencyAccessStatus');

const staleLog = (n, over = {}) => ({
  emergencyAccessID: `EA_S${n}`,
  relationshipID:    `TR_S${n}`,
  doctorID:          DOCTOR,
  patientID:         PATIENT,
  status:            'ACTIVE',
  save:              jest.fn(async () => {}),
  ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  contract.submitTransaction.mockImplementation(async () => Buffer.from(''));
  db.PatientAuth.findOne.mockResolvedValue({ patientID: PATIENT, phone: '9000000000' });
  db.Doctor.findOne.mockResolvedValue({ doctorID: DOCTOR, fullName: 'Test Doc' });
  db.EmergencyAccessLog.find.mockResolvedValue([]);
  trSvc.dischargePatient.mockResolvedValue({ status: 'SUCCESS' });
});

describe('listActiveEmergencyAccess', () => {
  const chain = (docs) => {
    const lean = jest.fn(async () => docs);
    const sort = jest.fn(() => ({ lean }));
    db.EmergencyAccessLog.find.mockReturnValue({ sort });
    return { sort, lean };
  };

  test("queries the doctor's own ACTIVE, unexpired episodes, newest first", async () => {
    const { sort } = chain([]);
    const before = Date.now();
    const r = await svc.listActiveEmergencyAccess(DOCTOR);
    expect(r).toEqual({ status: 'SUCCESS', data: [] });

    const [query] = db.EmergencyAccessLog.find.mock.calls[0];
    expect(query).toMatchObject({ doctorID: DOCTOR, status: 'ACTIVE' });
    const cutoff = new Date(query.expiresAt.$gt).getTime();
    expect(cutoff).toBeGreaterThanOrEqual(before - 1000);
    expect(cutoff).toBeLessThanOrEqual(Date.now() + 1000);
    expect(sort).toHaveBeenCalledWith({ createdAt: -1 });
  });

  test('returns only the documented fields', async () => {
    chain([{
      _id: 'mongo-id', __v: 0, closedBy: 'x', closedAt: 'y', doctorID: DOCTOR,
      emergencyAccessID: 'EA_1', relationshipID: 'TR_1', patientID: PATIENT,
      reason: 'unconscious', status: 'ACTIVE', createdAt: 'c', expiresAt: 'e',
    }]);
    const r = await svc.listActiveEmergencyAccess(DOCTOR);
    expect(r.status).toBe('SUCCESS');
    expect(r.data).toEqual([{
      emergencyAccessID: 'EA_1', relationshipID: 'TR_1', patientID: PATIENT,
      reason: 'unconscious', status: 'ACTIVE', createdAt: 'c', expiresAt: 'e',
    }]);
  });

  test('a database error becomes FAILED instead of throwing', async () => {
    db.EmergencyAccessLog.find.mockImplementation(() => { throw new Error('mongo down'); });
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const r = await svc.listActiveEmergencyAccess(DOCTOR);
    spy.mockRestore();
    expect(r).toEqual({ status: 'FAILED', message: 'mongo down' });
  });
});

describe('expireStaleEmergencyAccess', () => {
  test('selects only ACTIVE episodes whose expiry has passed', async () => {
    const before = Date.now();
    await svc.expireStaleEmergencyAccess();
    const [query] = db.EmergencyAccessLog.find.mock.calls[0];
    expect(query.status).toBe('ACTIVE');
    const cutoff = new Date(query.expiresAt.$lte).getTime();
    expect(cutoff).toBeGreaterThanOrEqual(before - 1000);
    expect(cutoff).toBeLessThanOrEqual(Date.now() + 1000);
  });

  test('nothing stale -> nothing touched, zero counts', async () => {
    const r = await svc.expireStaleEmergencyAccess();
    expect(r).toEqual({ scanned: 0, closed: 0, failed: 0 });
    expect(trSvc.dischargePatient).not.toHaveBeenCalled();
    expect(contract.submitTransaction).not.toHaveBeenCalled();
    expect(notif.notify).not.toHaveBeenCalled();
  });

  test('closes an expired episode end to end', async () => {
    const log = staleLog(1);
    db.EmergencyAccessLog.find.mockResolvedValue([log]);

    const r = await svc.expireStaleEmergencyAccess();
    expect(r).toEqual({ scanned: 1, closed: 1, failed: 0 });

    // backing relationship discharged, ownership check skipped, no separate discharge SMS
    expect(trSvc.dischargePatient).toHaveBeenCalledWith('TR_S1', DOCTOR, true, { notifyPatient: false });

    // ledger record marked CLOSED
    expect(ledgerUpdates()).toHaveLength(1);
    const [, id, status, updatedAt] = ledgerUpdates()[0];
    expect([id, status]).toEqual(['EA_S1', 'CLOSED']);
    expect(Number.isNaN(Date.parse(updatedAt))).toBe(false);

    // log closed by the system and saved
    expect(log.status).toBe('CLOSED');
    expect(log.closedBy).toBe('system');
    expect(Number.isNaN(Date.parse(log.closedAt))).toBe(false);
    expect(log.save).toHaveBeenCalledTimes(1);

    // audit entry attributes the action to the sweeper, not to a person
    expect(audit.logAudit).toHaveBeenCalledWith(expect.objectContaining({
      actorID: 'emergency-expiry-sweeper', actorRole: 'system',
      action: 'UPDATE', resourceType: 'EMERGENCY_ACCESS', resourceID: 'EA_S1',
    }));

    // patient told it has ended
    expect(notif.notify).toHaveBeenCalledWith(expect.objectContaining({
      event: 'EMERGENCY_ACCESS_ENDED', recipientID: PATIENT, recipientRole: 'patient', channel: 'sms',
    }));
    expect(notif.notify.mock.calls[0][0].message).toMatch(/Test Doc/);
    expect(notif.notify).toHaveBeenCalledTimes(1); // one message to the patient, not two
  });

  describe('when the ledger update fails', () => {
    const failLedger = () =>
      contract.submitTransaction.mockImplementation(async (fn) => {
        if (fn === 'UpdateEmergencyAccessStatus') throw new Error('ledger down');
        return Buffer.from('');
      });

    test('the episode stays ACTIVE, is counted as failed, and nothing else is recorded', async () => {
      const log = staleLog(1);
      db.EmergencyAccessLog.find.mockResolvedValue([log]);
      failLedger();
      const spy = jest.spyOn(console, 'error').mockImplementation(() => {});

      const r = await svc.expireStaleEmergencyAccess();
      spy.mockRestore();

      expect(r).toEqual({ scanned: 1, closed: 0, failed: 1 });
      expect(log.status).toBe('ACTIVE');
      expect(log.save).not.toHaveBeenCalled();
      expect(audit.logAudit).not.toHaveBeenCalled();
      expect(notif.notify).not.toHaveBeenCalled();
    });

    test('the next sweep retries it and closes it once the ledger is back', async () => {
      const log = staleLog(1);
      db.EmergencyAccessLog.find.mockResolvedValue([log]);
      failLedger();
      const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
      await svc.expireStaleEmergencyAccess();
      spy.mockRestore();
      expect(log.status).toBe('ACTIVE');

      contract.submitTransaction.mockImplementation(async () => Buffer.from(''));
      const r = await svc.expireStaleEmergencyAccess();

      expect(r).toEqual({ scanned: 1, closed: 1, failed: 0 });
      expect(log.status).toBe('CLOSED');
      expect(log.closedBy).toBe('system');
      expect(log.save).toHaveBeenCalledTimes(1);
      expect(notif.notify).toHaveBeenCalledTimes(1); // told once, after it finally closed
      expect(trSvc.dischargePatient).toHaveBeenCalledTimes(2);
      for (const call of trSvc.dischargePatient.mock.calls) {
        expect(call).toEqual(['TR_S1', DOCTOR, true, { notifyPatient: false }]); // retry never re-sends the discharge SMS
      }
    });
  });

  test('a failed discharge leaves that episode untouched and the sweep continues', async () => {
    const bad  = staleLog(1);
    const good = staleLog(2);
    db.EmergencyAccessLog.find.mockResolvedValue([bad, good]);
    trSvc.dischargePatient
      .mockResolvedValueOnce({ status: 'FAILED', message: 'ledger down' })
      .mockResolvedValueOnce({ status: 'SUCCESS' });
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const r = await svc.expireStaleEmergencyAccess();
    spy.mockRestore();

    expect(r).toEqual({ scanned: 2, closed: 1, failed: 1 });
    expect(bad.status).toBe('ACTIVE');
    expect(bad.save).not.toHaveBeenCalled();
    expect(good.status).toBe('CLOSED');
    expect(ledgerUpdates().map((c) => c[1])).toEqual(['EA_S2']); // none for the failed one
    expect(notif.notify).toHaveBeenCalledTimes(1);
  });

  test('an unexpected error on one episode does not stop the others', async () => {
    const boom = staleLog(1);
    const good = staleLog(2);
    db.EmergencyAccessLog.find.mockResolvedValue([boom, good]);
    trSvc.dischargePatient
      .mockRejectedValueOnce(new Error('unexpected'))
      .mockResolvedValueOnce({ status: 'SUCCESS' });
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const r = await svc.expireStaleEmergencyAccess();
    spy.mockRestore();

    expect(r).toEqual({ scanned: 2, closed: 1, failed: 1 });
    expect(boom.save).not.toHaveBeenCalled();
    expect(good.save).toHaveBeenCalledTimes(1);
  });

  test('a patient with no record is still closed, just not notified', async () => {
    const log = staleLog(1);
    db.EmergencyAccessLog.find.mockResolvedValue([log]);
    db.PatientAuth.findOne.mockResolvedValue(null);

    const r = await svc.expireStaleEmergencyAccess();
    expect(r).toEqual({ scanned: 1, closed: 1, failed: 0 });
    expect(log.status).toBe('CLOSED');
    expect(notif.notify).not.toHaveBeenCalled();
  });

  test('the query failing is thrown to the caller (the worker logs it)', async () => {
    db.EmergencyAccessLog.find.mockRejectedValue(new Error('mongo down'));
    await expect(svc.expireStaleEmergencyAccess()).rejects.toThrow('mongo down');
  });
});
