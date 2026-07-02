/**
 * __mocks__/consultationFabricService.js
 *
 * Domain-level mock matching the real consultationFabricService.js exports
 * exactly: createConsultation, getConsultation, getConsultationDocument,
 * updateConsultation.
 *
 * Use this ONLY in tests that want to control what /consultations routes
 * return directly, bypassing the real sensitivity/permission/audit logic
 * inside consultationFabricService.js itself.
 *
 * If a test needs that real logic to execute (e.g. auditMiddleware.test.js,
 * ipfsKmsRoundTrip.test.js), do NOT mock this file — mock fabricService,
 * ipfsService, kmsService instead and let the real module run on top.
 */

'use strict';

let _seq = 1;
const nextID = (prefix) => `${prefix}${String(_seq++).padStart(4, '0')}`;
const SUCCESS = (extra = {}) => ({ status: 'SUCCESS', ...extra });

const createConsultation = jest.fn(async (data) => SUCCESS({
  consultationID:   data.consultationID || nextID('CONS'),
  consultationCID:  'bafymock-consultation-cid',
  consultationHash: 'mockhash',
  sensitivityLevel: 'NORMAL',
  encryptionKeyRef: nextID('KEY'),
}));

const getConsultation = jest.fn(async (consultationID) => SUCCESS({
  data: {
    consultationID,
    patientID:        'PAT0001',
    sensitivityLevel: 'NORMAL',
    consultationCID:  'bafymock-consultation-cid',
    encryptionKeyRef: 'KEY0001',
  },
}));

const getConsultationDocument = jest.fn(async () => SUCCESS({
  document: Buffer.from('%PDF-1.4 mock content'),
}));

const updateConsultation = jest.fn(async (data) => SUCCESS({
  consultationID:   data.consultationID,
  consultationCID:  'bafymock-updated-cid',
  encryptionKeyRef: nextID('KEY'),
}));

const __resetAll = () => {
  [createConsultation, getConsultation, getConsultationDocument, updateConsultation]
    .forEach((fn) => fn.mockClear());
  _seq = 1;
};

module.exports = {
  createConsultation,
  getConsultation,
  getConsultationDocument,
  updateConsultation,
  __resetAll,
};
