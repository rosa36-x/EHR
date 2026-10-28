/**
 * unit/anomalyDetectionService.test.js
 *
 * Runs the REAL anomalyDetectionService.js with the Python scripts, Mongo models, audit log and
 * notifications mocked. Checks the tier semantics of the deployed pipeline:
 *
 * P1 only (default, ANOMALY_ENABLE_P2 unset)
 *   - p1_detector.py is the only scorer; lstm_sequence_model.py / priority_tagging.py are never run
 *   - only p1_ensemble.joblib + thresholds.json are required (no lstm_model.pt)
 *   - a P1 row becomes a PENDING P1 flag, the actor is notified, and a clarification is requested
 *     for the actor's first two P1 flags only (quota counted against P1 flags)
 *   - rows with priority "none" create nothing; a stray P2 row is ignored
 *   - missing artifacts -> no flags, no scripts run
 * Experimental P2 (ANOMALY_ENABLE_P2=true)
 *   - LSTM + priority_tagging run after P1
 *   - a P2 flag is ADVISORY: classification "sequential", no clarification, actor not notified,
 *     and it does not use the P1 clarification quota
 */

'use strict';

const fs = require('fs');

const mockExec = jest.fn();
jest.mock('child_process', () => ({ execFile: (...a) => mockExec(...a) }));
jest.mock('../../../../backend/services/auditMiddleware', () => ({ logAudit: jest.fn(async () => 'AUD1') }));
jest.mock('../../../../backend/services/idService', () => {
  let n = 0;
  return { generateID: () => `FLAG${++n}` };
});
jest.mock('../../../../backend/services/notificationService', () => ({
  notify: jest.fn(async () => {}),
  sendEmail: jest.fn(async () => {}),
  NotificationEvents: {
    ANOMALY_CLARIFICATION_REQUEST: (r, id) => `clarify ${r} ${id}`,
    ANOMALY_WARNING: (r) => `warn ${r}`,
    ACCOUNT_SUSPENDED: () => 'suspended',
  },
}));

const saved = [];
jest.mock('../../../../backend/services/db', () => {
  function AnomalyFlag(doc) { this.doc = doc; this.save = async () => { saved.push(doc); }; }
  AnomalyFlag.findOne = jest.fn(async () => null);
  AnomalyFlag.countDocuments = jest.fn(async () => 0);
  const lean = (v) => ({ lean: async () => v });
  return {
    AnomalyFlag,
    AuditLogMirror: { find: jest.fn(() => lean([{ auditID: 'a', actorID: 'ORG1', actorRole: 'org_actor',
      actorOrg: 'PharmacyMSP', action: 'READ', resourceType: 'PRESCRIPTION', resourceID: 'R1',
      timestamp: new Date().toISOString() }])) },
    OrgActor: { findOne: jest.fn(async () => ({ phone: '9', email: 'a@b.c', fullName: 'Org One' })) },
    Doctor: { findOne: jest.fn() },
    PatientAuth: { findOne: jest.fn() },
    EmergencyAccessLog: { findOne: jest.fn(() => lean(null)) },
  };
});

const COLS = 'actorID,date,anomaly_score,votes,top_features,priority,lstm_score,ensemble_score';
const feat = JSON.stringify([{ feature: 'off_hours_ratio', contribution: 3.2 }]).replace(/"/g, '""');
const row = (actor, priority, extra = '') => `${actor},2026-03-31,0.8,3,"${feat}",${priority},${extra}`;

/** Fake the Python scripts: each writes the CSV the service expects at its --out path. */
function fakeScripts(p1Csv, taggedCsv) {
  mockExec.mockImplementation((bin, args, cb) => {
    const out = args[args.indexOf('--out') + 1];
    const script = args[0].split('/').pop();
    if (script === 'p1_detector.py') fs.writeFileSync(out, p1Csv);
    else if (script === 'priority_tagging.py') fs.writeFileSync(out, taggedCsv);
    else fs.writeFileSync(out, 'x\n');
    cb(null, '', '');
  });
}
const scriptsRun = () => mockExec.mock.calls.map((c) => c[1][0].split('/').pop());

const svc   = require('../../../../backend/services/anomalyDetectionService');
const db    = require('../../../../backend/services/db');
const notif = require('../../../../backend/services/notificationService');

function load(env = {}) {
  delete process.env.ANOMALY_ENABLE_P2;
  Object.assign(process.env, env);
  return { svc, db, notif };
}

beforeEach(() => {
  mockExec.mockReset();
  saved.length = 0;
  db.AnomalyFlag.countDocuments.mockReset().mockResolvedValue(0);
  notif.notify.mockClear();
  jest.spyOn(fs, 'existsSync').mockReturnValue(true);
});
afterEach(() => { jest.restoreAllMocks(); delete process.env.ANOMALY_ENABLE_P2; });

describe('P1 only (default)', () => {
  test('runs only feature engineering + p1_detector; creates a P1 flag with clarification and notification', async () => {
    const { svc, notif } = load();
    fakeScripts([
      'actorID,date,anomaly_score,votes,top_features,priority',
      `ORG1,2026-03-31,0.8,3,"${feat}",P1_high_confidence`,
      `ORG2,2026-03-31,0.1,0,"${feat}",none`,
    ].join('\n'));

    const res = await svc.runDetectionCycle();

    expect(res.flagsCreated).toBe(1);
    expect(scriptsRun()).toEqual(['feature_engineering.py', 'p1_detector.py']);
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({
      actorID: 'ORG1', priority: 'P1_high_confidence', classification: 'point', status: 'PENDING',
      ifScore: 0.8, combinedScore: 0.8, lstmScore: null, clarificationRequested: true,
    });
    expect(notif.notify).toHaveBeenCalledTimes(1);
    expect(notif.notify.mock.calls[0][0].event).toBe('ANOMALY_CLARIFICATION_REQUEST');
  });

  test('clarification quota is counted against P1 flags only; third P1 flag gets a warning instead', async () => {
    const { svc, db, notif } = load();
    db.AnomalyFlag.countDocuments.mockResolvedValue(2);
    fakeScripts(`actorID,date,anomaly_score,votes,top_features,priority\nORG1,2026-03-31,0.8,3,"${feat}",P1_high_confidence`);

    await svc.runDetectionCycle();

    expect(db.AnomalyFlag.countDocuments).toHaveBeenCalledWith({ actorID: 'ORG1', priority: 'P1_high_confidence' });
    expect(saved[0].clarificationRequested).toBe(false);
    expect(notif.notify.mock.calls[0][0].event).toBe('ANOMALY_WARNING');
  });

  test('a stray P2 row is ignored when P2 is disabled', async () => {
    const { svc } = load();
    fakeScripts(`actorID,date,anomaly_score,votes,top_features,priority\nORG1,2026-03-31,0.1,0,"${feat}",P2_sequence_candidate`);
    expect((await svc.runDetectionCycle()).flagsCreated).toBe(0);
    expect(saved).toHaveLength(0);
  });

  test('missing P1 artifact -> no scripts, no flags; lstm_model.pt is not required', async () => {
    const { svc } = load();
    const checked = [];
    fs.existsSync.mockImplementation((p) => { checked.push(String(p).split('/').pop()); return !String(p).endsWith('p1_ensemble.joblib'); });
    fakeScripts('x\n');
    expect((await svc.runDetectionCycle()).flagsCreated).toBe(0);
    expect(mockExec).not.toHaveBeenCalled();
    expect(checked).toEqual(['p1_ensemble.joblib', 'thresholds.json']);
  });

  test('isP2Enabled() is false', () => {
    expect(load().svc.isP2Enabled()).toBe(false);
  });
});

describe('experimental P2 (ANOMALY_ENABLE_P2=true)', () => {
  const tagged = [
    'actorID,date,ensemble_score,lstm_score,top_features,priority',
    `ORG1,2026-03-31,0.8,2.0,"${feat}",P1_high_confidence`,
    `ORG2,2026-03-31,0.2,6.1,"${feat}",P2_sequence_candidate`,
  ].join('\n');

  test('runs LSTM + priority_tagging; P2 flag is advisory (no clarification, no notification)', async () => {
    const { svc, db, notif } = load({ ANOMALY_ENABLE_P2: 'true' });
    fakeScripts('actorID,date,anomaly_score\nORG1,2026-03-31,0.8', tagged);

    const res = await svc.runDetectionCycle();

    expect(res.flagsCreated).toBe(2);
    expect(scriptsRun()).toEqual(['feature_engineering.py', 'p1_detector.py', 'lstm_sequence_model.py', 'priority_tagging.py']);
    const p1 = saved.find((f) => f.actorID === 'ORG1');
    const p2 = saved.find((f) => f.actorID === 'ORG2');
    expect(p1).toMatchObject({ priority: 'P1_high_confidence', combinedScore: 0.8, clarificationRequested: true });
    expect(p2).toMatchObject({ priority: 'P2_sequence_candidate', classification: 'sequential',
      combinedScore: 6.1, lstmScore: 6.1, clarificationRequested: false });
    expect(notif.notify).toHaveBeenCalledTimes(1);                       // P1 actor only
    expect(notif.notify.mock.calls[0][0].recipientID).toBe('ORG1');
    expect(db.AnomalyFlag.countDocuments).toHaveBeenCalledTimes(1);     // quota query only for the P1 row
    expect(svc.isP2Enabled()).toBe(true);
  });

  test('requires lstm_model.pt as well', async () => {
    const { svc } = load({ ANOMALY_ENABLE_P2: 'true' });
    fs.existsSync.mockImplementation((p) => !String(p).endsWith('lstm_model.pt'));
    expect((await svc.runDetectionCycle()).flagsCreated).toBe(0);
    expect(mockExec).not.toHaveBeenCalled();
  });
});
