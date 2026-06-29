/**
 * __mocks__/fabricService.js
 *
 * Stubs every fabricService function used by unit tests.
 * Integration tests bypass this mock and hit the real network.
 *
 * Each function returns a minimal SUCCESS payload shaped to match
 * what the real chaincode returns, so route handlers work correctly.
 *
 * Call jest.mock('../../services/fabricService') in any unit test
 * that should not touch the Fabric network.
 */

'use strict';

// ── helpers ────────────────────────────────────────────────────────────────────
let _seq = 1;
const nextID = (prefix) => `${prefix}${String(_seq++).padStart(4, '0')}`;

const SUCCESS = (extra = {}) => ({ status: 'SUCCESS', ...extra });

// ── patient ────────────────────────────────────────────────────────────────────
const createPatient = jest.fn(async (data) =>
  SUCCESS({
    patientID:    nextID('PAT'),
    aadhaarVID:   'VID-MOCK-0001',
    aadhaarToken: 'TOK-MOCK-0001',
    ...data,
  })
);
const getPatient = jest.fn(async (patientID) =>
  SUCCESS({ data: { patientID, fullName: 'Mock Patient', status: 'ACTIVE' } })
);

// ── consultation ───────────────────────────────────────────────────────────────
const createConsultation = jest.fn(async (data) =>
  SUCCESS({
    consultationID:  data.consultationID || nextID('CONS'),
    consultationCID: 'bafymock-consultation-cid',
    encryptionKeyRef: nextID('KEY'),
    sensitivityLevel: 'NORMAL',
  })
);
const getConsultation = jest.fn(async (consultationID, actorID, actorRole) =>
  SUCCESS({
    data: {
      consultationID,
      patientID:       'PAT0001',
      sensitivityLevel: 'NORMAL',
      consultationCID:  'bafymock-consultation-cid',
      encryptionKeyRef: 'KEY0001',
    },
  })
);
const updateConsultation = jest.fn(async (consultationID, data) =>
  SUCCESS({
    consultationID,
    consultationCID:  'bafymock-updated-cid',
    encryptionKeyRef: nextID('KEY'),
  })
);

// ── prescription ───────────────────────────────────────────────────────────────
const createPrescription = jest.fn(async (data) =>
  SUCCESS({
    prescriptionID:   data.prescriptionID || nextID('PRE'),
    prescriptionCID:  'bafymock-prescription-cid',
    encryptionKeyRef: nextID('KEY'),
    sensitivityLevel: 'NORMAL',
  })
);
const getPrescription   = jest.fn(async (id) => SUCCESS({ data: { prescriptionID: id, status: 'ISSUED' } }));
const updatePrescStatus = jest.fn(async ()   => SUCCESS());

// ── lab report ─────────────────────────────────────────────────────────────────
const createLabReport = jest.fn(async (data) =>
  SUCCESS({
    reportID:         data.reportID || nextID('LAB'),
    reportCID:        'bafymock-labreport-cid',
    encryptionKeyRef: nextID('KEY'),
    sensitivityLevel: 'NORMAL',
  })
);
const getLabReport = jest.fn(async (id) => SUCCESS({ data: { reportID: id, reportType: 'BLOOD_TEST' } }));

// ── referral ───────────────────────────────────────────────────────────────────
const createReferral = jest.fn(async (data) =>
  SUCCESS({ referralID: data.referralID || nextID('REF'), referralCID: 'bafymock-referral-cid' })
);
const getReferral = jest.fn(async (id) => SUCCESS({ data: { referralID: id } }));

// ── consent ────────────────────────────────────────────────────────────────────
const grantConsent  = jest.fn(async (data) => SUCCESS({ consentID: data.consentID || nextID('CON') }));
const checkConsent  = jest.fn(async ()      => SUCCESS({ isActive: true }));
const revokeConsent = jest.fn(async ()      => SUCCESS());

// ── treatment relationship ─────────────────────────────────────────────────────
const createTreatmentRelationship  = jest.fn(async () => SUCCESS({ relationshipID: nextID('TR') }));
const getTreatmentRelationship     = jest.fn(async (id) =>
  SUCCESS({ data: { relationshipID: id, status: 'ACTIVE' } })
);
const markDormant   = jest.fn(async () => SUCCESS());
const reactivate    = jest.fn(async () => SUCCESS());

// ── permission request ─────────────────────────────────────────────────────────
const createPermissionRequest  = jest.fn(async () =>
  SUCCESS({
    requestID:  nextID('PREQ'),
    expiresAt:  new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  })
);
const getPermissionRequest     = jest.fn(async (id) =>
  SUCCESS({ data: { requestID: id, status: 'PENDING' } })
);
const approvePermissionRequest = jest.fn(async () =>
  SUCCESS({ accessExpires: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString() })
);
const rejectPermissionRequest  = jest.fn(async () => SUCCESS());

// ── emergency access ───────────────────────────────────────────────────────────
const createEmergencyAccess = jest.fn(async () =>
  SUCCESS({ emergencyAccessID: nextID('EA') })
);
const getEmergencyAccess    = jest.fn(async (id) =>
  SUCCESS({ data: { emergencyAccessID: id, status: 'ACTIVE' } })
);

// ── audit ──────────────────────────────────────────────────────────────────────
const createAuditLog = jest.fn(async () => SUCCESS({ auditID: nextID('AUD') }));
const getAuditLog    = jest.fn(async (id) =>
  SUCCESS({
    data: {
      auditID:      id,
      actorID:      'DOC0001',
      actorRole:    'doctor',
      action:       'READ',
      resourceType: 'CONSULTATION',
      resourceID:   'CONS0001',
      timestamp:    new Date().toISOString(),
    },
  })
);

/** Reset all mock call counts between tests. */
const __resetAll = () => {
  [
    createPatient, getPatient,
    createConsultation, getConsultation, updateConsultation,
    createPrescription, getPrescription, updatePrescStatus,
    createLabReport, getLabReport,
    createReferral, getReferral,
    grantConsent, checkConsent, revokeConsent,
    createTreatmentRelationship, getTreatmentRelationship, markDormant, reactivate,
    createPermissionRequest, getPermissionRequest, approvePermissionRequest, rejectPermissionRequest,
    createEmergencyAccess, getEmergencyAccess,
    createAuditLog, getAuditLog,
  ].forEach((fn) => fn.mockClear());
  _seq = 1;
};

module.exports = {
  createPatient, getPatient,
  createConsultation, getConsultation, updateConsultation,
  createPrescription, getPrescription, updatePrescStatus,
  createLabReport, getLabReport,
  createReferral, getReferral,
  grantConsent, checkConsent, revokeConsent,
  createTreatmentRelationship, getTreatmentRelationship, markDormant, reactivate,
  createPermissionRequest, getPermissionRequest, approvePermissionRequest, rejectPermissionRequest,
  createEmergencyAccess, getEmergencyAccess,
  createAuditLog, getAuditLog,
  __resetAll,
};
