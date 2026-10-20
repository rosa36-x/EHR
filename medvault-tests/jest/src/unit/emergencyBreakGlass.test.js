/**
 * unit/emergencyBreakGlass.test.js
 *
 * Runs the REAL accessControlService.js and the REAL list/get functions of
 * consultation / prescription / lab-report services against mocked Mongo,
 * ledger and relationship/permission services, to check break-glass:
 *   - a doctor with an OPEN emergency episode reads SENSITIVE records without
 *     a permission request, and the override is audited as EMERGENCY_OVERRIDE
 *   - the override ends with the episode: CLOSED/expired log, discharged,
 *     expired or wrong-type backing relationship, or any lookup error => denied
 *   - the override is scoped to the (doctor, patient) pair of the episode
 *   - a normal approved permission never triggers the override path
 *   - NORMAL records and patient actors are unaffected
 */

'use strict';

jest.mock('../../../../backend/services/fabricService',                  () => require('../__mocks__/fabricService'));
jest.mock('../../../../backend/services/kmsService',                     () => require('../__mocks__/kmsService'));
jest.mock('../../../../backend/services/ipfsService',                    () => require('../__mocks__/ipfsService'));
jest.mock('../../../../backend/services/notificationService',            () => require('../__mocks__/notificationService'));
jest.mock('../../../../backend/services/treatmentRelationshipFabricService', () => require('../__mocks__/treatmentRelationshipFabricService'));
jest.mock('../../../../backend/services/permissionRequestFabricService', () => require('../__mocks__/permissionRequestFabricService'));
jest.mock('../../../../backend/services/auditMiddleware',                () => ({ logAudit: jest.fn() }));
jest.mock('../../../../backend/services/db', () => ({
  PatientAuth:        { findOne: jest.fn() },
  Doctor:             { findOne: jest.fn() },
  EmergencyAccessLog: { findOne: jest.fn() },
}));

const fabric = require('../../../../backend/services/fabricService');
const db     = require('../../../../backend/services/db');
const audit  = require('../../../../backend/services/auditMiddleware');
const trMock = require('../../../../backend/services/treatmentRelationshipFabricService');
const permMock = require('../../../../backend/services/permissionRequestFabricService');
const { canAccessRecord, hasActiveEmergencyAccess } = require('../../../../backend/services/accessControlService');
const consultationSvc  = require('../../../../backend/services/consultationFabricService');
const prescriptionSvc  = require('../../../../backend/services/prescriptionFabricService');
const labSvc           = require('../../../../backend/services/labReportFabricService');

const DOCTOR  = 'DOC_BG1';
const PATIENT = 'PAT_BG1';
const future = () => new Date(Date.now() + 3600 * 1000).toISOString();
const past   = () => new Date(Date.now() - 3600 * 1000).toISOString();

const sensitiveArgs = (over = {}) => ({
  actorID: DOCTOR, actorRole: 'doctor', patientID: PATIENT,
  resourceID: 'CONS_S1', resourceType: 'CONSULTATION', sensitivityLevel: 'SENSITIVE', ...over,
});
const auditActions = () => audit.logAudit.mock.calls.map((c) => c[0].action);

const openEpisode = (relOver = {}) => {
  db.EmergencyAccessLog.findOne.mockResolvedValue({ emergencyAccessID: 'EA_BG1', relationshipID: 'TR_BG1', doctorID: DOCTOR, patientID: PATIENT, status: 'ACTIVE' });
  trMock.getTreatmentRelationship.mockResolvedValue({
    status: 'SUCCESS',
    data: { relationshipID: 'TR_BG1', relationshipType: 'ASSIGNED_EMERGENCY_PHYSICIAN', status: 'ACTIVE', dormantAfter: future(), ...relOver },
  });
};

beforeEach(() => {
  jest.clearAllMocks();
  fabric.__resetAll();
  permMock.hasActivePermission.mockResolvedValue(false);
  trMock.hasActiveTreatmentRelationship.mockResolvedValue(true);
  db.EmergencyAccessLog.findOne.mockResolvedValue(null);
});

describe('canAccessRecord - SENSITIVE record', () => {
  test('open emergency episode -> allowed, audited as EMERGENCY_OVERRIDE', async () => {
    openEpisode();
    const r = await canAccessRecord(sensitiveArgs());
    expect(r).toEqual({ allowed: true, emergencyOverride: true });
    expect(auditActions()).toEqual(['EMERGENCY_OVERRIDE']);
    expect(audit.logAudit.mock.calls[0][0]).toEqual(expect.objectContaining({ actorID: DOCTOR, resourceType: 'CONSULTATION', resourceID: 'CONS_S1' }));
  });

  test('episode lookup is scoped to this doctor + patient and to ACTIVE, unexpired episodes', async () => {
    openEpisode();
    await canAccessRecord(sensitiveArgs());
    const q = db.EmergencyAccessLog.findOne.mock.calls[0][0];
    expect(q).toEqual({ doctorID: DOCTOR, patientID: PATIENT, status: 'ACTIVE', expiresAt: { $gt: expect.any(String) } });
  });

  test('approved permission -> allowed without touching the emergency path', async () => {
    permMock.hasActivePermission.mockResolvedValue(true);
    const r = await canAccessRecord(sensitiveArgs());
    expect(r).toEqual({ allowed: true });
    expect(db.EmergencyAccessLog.findOne).not.toHaveBeenCalled();
    expect(audit.logAudit).not.toHaveBeenCalled();
  });

  test('no permission, no episode (never opened, CLOSED or expired) -> denied', async () => {
    const r = await canAccessRecord(sensitiveArgs());
    expect(r.allowed).toBe(false);
    expect(r.status).toBe('ACCESS_DENIED');
    expect(r.requiresPermission).toBe(true);
    expect(auditActions()).toEqual(['ACCESS_DENIED']);
  });

  test('episode log ACTIVE but backing relationship DISCHARGED -> denied', async () => {
    openEpisode({ status: 'DISCHARGED' });
    expect((await canAccessRecord(sensitiveArgs())).allowed).toBe(false);
    expect(auditActions()).toEqual(['ACCESS_DENIED']);
  });

  test('episode log ACTIVE but backing relationship past its expiry -> denied', async () => {
    openEpisode({ dormantAfter: past() });
    expect((await canAccessRecord(sensitiveArgs())).allowed).toBe(false);
  });

  test('log points at a non-emergency relationship -> denied', async () => {
    openEpisode({ relationshipType: 'ONGOING_TREATMENT' });
    expect((await canAccessRecord(sensitiveArgs())).allowed).toBe(false);
  });

  test('relationship lookup fails -> denied', async () => {
    openEpisode();
    trMock.getTreatmentRelationship.mockResolvedValue({ status: 'FAILED', message: 'ledger down' });
    expect((await canAccessRecord(sensitiveArgs())).allowed).toBe(false);
  });

  test('Mongo error -> fails closed, denied', async () => {
    db.EmergencyAccessLog.findOne.mockRejectedValue(new Error('mongo down'));
    expect((await canAccessRecord(sensitiveArgs())).allowed).toBe(false);
  });

  test('a thrown relationship lookup -> fails closed, denied', async () => {
    openEpisode();
    trMock.getTreatmentRelationship.mockRejectedValue(new Error('gateway'));
    expect((await canAccessRecord(sensitiveArgs())).allowed).toBe(false);
  });
});

describe('canAccessRecord - everything else is unchanged', () => {
  test('NORMAL record: treatment relationship decides, emergency path not consulted', async () => {
    const ok = await canAccessRecord(sensitiveArgs({ sensitivityLevel: 'NORMAL' }));
    expect(ok).toEqual({ allowed: true });
    trMock.hasActiveTreatmentRelationship.mockResolvedValue(false);
    const no = await canAccessRecord(sensitiveArgs({ sensitivityLevel: 'NORMAL' }));
    expect(no.allowed).toBe(false);
    expect(db.EmergencyAccessLog.findOne).not.toHaveBeenCalled();
  });

  test('patient actors: own record allowed, other patient denied, no emergency lookup', async () => {
    expect((await canAccessRecord(sensitiveArgs({ actorID: PATIENT, actorRole: 'patient' }))).allowed).toBe(true);
    expect((await canAccessRecord(sensitiveArgs({ actorID: 'PAT_OTHER', actorRole: 'patient' }))).allowed).toBe(false);
    expect(db.EmergencyAccessLog.findOne).not.toHaveBeenCalled();
  });

  test('org actors: unchanged (consent is enforced on-chain), no emergency lookup', async () => {
    expect((await canAccessRecord(sensitiveArgs({ actorID: 'ORG1', actorRole: 'org_actor' }))).allowed).toBe(true);
    expect(db.EmergencyAccessLog.findOne).not.toHaveBeenCalled();
  });
});

describe('hasActiveEmergencyAccess', () => {
  test('true for an open episode, false otherwise', async () => {
    openEpisode();
    expect(await hasActiveEmergencyAccess(DOCTOR, PATIENT)).toBe(true);
    db.EmergencyAccessLog.findOne.mockResolvedValue(null);
    expect(await hasActiveEmergencyAccess(DOCTOR, PATIENT)).toBe(false);
  });
});

describe('list endpoints honour the override', () => {
  const stubList = (fnName, items) => {
    fabric.__contract.evaluateTransaction.mockImplementation(async (fn) =>
      fn === fnName ? Buffer.from(JSON.stringify(items)) : Buffer.from('{}'));
  };

  const cases = [
    { name: 'consultations', fn: () => consultationSvc.getConsultationsByPatient, cc: 'GetConsultationsByPatient', idf: 'consultationID' },
    { name: 'prescriptions', fn: () => prescriptionSvc.getPrescriptionsByPatient, cc: 'GetPrescriptionsByPatient', idf: 'prescriptionID' },
    { name: 'lab reports',   fn: () => labSvc.getLabReportsByPatient,             cc: 'GetLabReportsByPatient',     idf: 'reportID' },
  ];

  describe.each(cases)('$name', ({ fn, cc, idf }) => {
    const items = () => [
      { [idf]: 'N1', sensitivityLevel: 'NORMAL' },
      { [idf]: 'S_PERM', sensitivityLevel: 'SENSITIVE' },
      { [idf]: 'S_NOPERM', sensitivityLevel: 'SENSITIVE' },
    ];
    beforeEach(() => {
      stubList(cc, items());
      permMock.hasActivePermission.mockImplementation(async (_d, id) => id === 'S_PERM');
    });

    test('no episode: sensitive items without a permission stay hidden', async () => {
      const r = await fn()(PATIENT, DOCTOR, 'doctor');
      expect(r.status).toBe('SUCCESS');
      expect(r.data.map((x) => x[idf])).toEqual(['N1', 'S_PERM']);
    });

    test('open episode: all sensitive items visible, episode looked up once', async () => {
      openEpisode();
      const r = await fn()(PATIENT, DOCTOR, 'doctor');
      expect(r.data.map((x) => x[idf])).toEqual(['N1', 'S_PERM', 'S_NOPERM']);
      expect(db.EmergencyAccessLog.findOne).toHaveBeenCalledTimes(1);
    });

    test('patient list is unchanged', async () => {
      const r = await fn()(PATIENT, PATIENT, 'patient');
      expect(r.data).toHaveLength(3);
      expect(db.EmergencyAccessLog.findOne).not.toHaveBeenCalled();
    });
  });
});

describe('getConsultation (by id) with a sensitive record', () => {
  const record = { consultationID: 'CONS_S1', patientID: PATIENT, doctorID: 'DOC_OWNER', sensitivityLevel: 'SENSITIVE' };
  beforeEach(() => {
    fabric.__contract.evaluateTransaction.mockImplementation(async (fn) =>
      fn === 'GetConsultation' ? Buffer.from(JSON.stringify(record)) : Buffer.from('{}'));
  });

  test('open episode -> SUCCESS, audited EMERGENCY_OVERRIDE then READ', async () => {
    openEpisode();
    const r = await consultationSvc.getConsultation('CONS_S1', DOCTOR, 'doctor');
    expect(r.status).toBe('SUCCESS');
    expect(auditActions()).toEqual(['EMERGENCY_OVERRIDE', 'READ']);
  });

  test('no episode -> ACCESS_DENIED with requiresPermission', async () => {
    const r = await consultationSvc.getConsultation('CONS_S1', DOCTOR, 'doctor');
    expect(r.status).toBe('ACCESS_DENIED');
    expect(r.requiresPermission).toBe(true);
    expect(auditActions()).toEqual(['ACCESS_DENIED']);
  });
});
