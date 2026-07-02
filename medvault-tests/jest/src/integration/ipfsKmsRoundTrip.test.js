/**
 * integration/ipfsKmsRoundTrip.test.js
 *
 * Verifies that:
 *   1. Uploading a consultation stores a CID and a KMS keyRef on the ledger
 *   2. Downloading the document decrypts via KMS and returns the original file
 *   3. A missing / corrupted CID returns a 500 with a meaningful error
 *   4. A missing KMS keyRef returns a 500 with a meaningful error
 *
 * consultationFabricService is intentionally left UNMOCKED here so its real
 * encrypt -> upload / download -> decrypt calls actually run against the
 * ipfsService and kmsService mocks - that round trip is exactly what this
 * file tests. Only fabricService (the raw ledger boundary) is faked; we
 * capture the CID/keyRef the real code generates on create and feed them
 * back through fabricService's GetConsultation response so the later
 * download step can find them, mirroring what a real ledger would return.
 */

'use strict';

jest.mock('../../../../backend/services/fabricService',       () => require('../__mocks__/fabricService'));
jest.mock('../../../../backend/services/notificationService', () => require('../__mocks__/notificationService'));
jest.mock('../../../../backend/services/ipfsService',         () => require('../__mocks__/ipfsService'));
jest.mock('../../../../backend/services/kmsService',          () => require('../__mocks__/kmsService'));

const supertest      = require('supertest');
const app            = require('../../../../backend/server');
const { makeToken }  = require('../helpers');
const ipfsMock       = require('../../../../backend/services/ipfsService');
const kmsMock        = require('../../../../backend/services/kmsService');
const fabricMock     = require('../../../../backend/services/fabricService');

process.env.MONGODB_URI = process.env.MONGODB_URI_TEST || 'mongodb://localhost:27017/medvault_test';

const DOCTOR_ID  = 'DOC_IPFS_001';
const PATIENT_ID = 'PAT_IPFS_001';
const doctorToken = makeToken('doctor', DOCTOR_ID);
const TEST_PDF    = Buffer.from('%PDF-1.4 test consultation document');

const CONS_ID = 'CONS_IPFS_ROUNDTRIP_001';
let storedCID;
let storedKeyRef;

beforeAll(() => {
  fabricMock.__contract.evaluateTransaction.mockImplementation(async (fnName, ...args) => {
    if (fnName === 'GetConsultation') {
      return Buffer.from(JSON.stringify({
        consultationID:   args[0],
        patientID:        PATIENT_ID,
        sensitivityLevel: 'NORMAL',
        consultationCID:  storedCID,
        encryptionKeyRef: storedKeyRef,
      }));
    }
    if (fnName === 'CheckActiveTreatmentRelationship') {
      return Buffer.from('true'); // NORMAL record - just needs an active TR
    }
    return Buffer.from('{}');
  });
});

afterEach(() => {
  ipfsMock.__resetAll();
  kmsMock.__resetAll();
});

describe('IPFS + KMS round-trip via consultation route', () => {
  test('POST /consultations - uploadFile called, CID stored', async () => {
    const res = await supertest(app)
      .post('/consultations')
      .set('Authorization', `Bearer ${doctorToken}`)
      .field('consultationID', CONS_ID)
      .field('patientID',      PATIENT_ID)
      .field('doctorID',       DOCTOR_ID)
      .field('diagnosis',      'Routine checkup')
      .field('recordType',     'GENERAL')
      .attach('file', TEST_PDF, 'test.pdf');

    expect(res.status).toBe(200);
    expect(res.body.consultationCID).toBeDefined();

    storedCID    = res.body.consultationCID;
    storedKeyRef = res.body.encryptionKeyRef;

    // IPFS upload was called with a Buffer (the encrypted file)
    expect(ipfsMock.uploadFile).toHaveBeenCalledTimes(1);
    const uploadArg = ipfsMock.uploadFile.mock.calls[0][0];
    expect(Buffer.isBuffer(uploadArg)).toBe(true);

    // KMS encryptDocument was called
    expect(kmsMock.encryptDocument).toHaveBeenCalledTimes(1);
  });

  test('GET /consultations/:id/document - decryptDocument called with correct keyRef', async () => {
    // First create so storedCID/storedKeyRef are populated
    const createRes = await supertest(app)
      .post('/consultations')
      .set('Authorization', `Bearer ${doctorToken}`)
      .field('consultationID', CONS_ID)
      .field('patientID',      PATIENT_ID)
      .field('doctorID',       DOCTOR_ID)
      .field('diagnosis',      'Checkup for download test')
      .field('recordType',     'GENERAL')
      .attach('file', TEST_PDF, 'test.pdf');

    storedCID    = createRes.body.consultationCID;
    storedKeyRef = createRes.body.encryptionKeyRef;

    
    ipfsMock.uploadFile.mockClear();
    ipfsMock.getFile.mockClear();
    kmsMock.encryptDocument.mockClear();
    kmsMock.decryptDocument.mockClear();

    const res = await supertest(app)
      .get(`/consultations/${CONS_ID}/document`)
      .set('Authorization', `Bearer ${doctorToken}`);
      if (res.status !== 200) console.log('BODY:', res.body, res.text);  


    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/pdf');

    // getFile and decryptDocument must both have been called
    expect(ipfsMock.getFile).toHaveBeenCalledTimes(1);
    expect(kmsMock.decryptDocument).toHaveBeenCalledTimes(1);

    // decryptDocument must have received the correct keyRef
    const [, keyRefArg] = kmsMock.decryptDocument.mock.calls[0];
    expect(keyRefArg).toBe(storedKeyRef);
  });

  test('GET /consultations/:id/document - invalid CID -> 500', async () => {
    // A CID that was never uploaded to the mock IPFS store
    storedCID = 'notavalidcid12345';

    const res = await supertest(app)
      .get(`/consultations/${CONS_ID}/document`)
      .set('Authorization', `Bearer ${doctorToken}`);

    expect(res.status).toBe(500);
    expect(res.body.status).toBe('FAILED');
  });

  test('GET /consultations/:id/document - missing keyRef -> 500', async () => {
    // Re-create to get a valid CID, but drop the keyRef the ledger "returns"
    const createRes = await supertest(app)
      .post('/consultations')
      .set('Authorization', `Bearer ${doctorToken}`)
      .field('consultationID', CONS_ID)
      .field('patientID',      PATIENT_ID)
      .field('doctorID',       DOCTOR_ID)
      .field('diagnosis',      'Checkup for missing keyRef test')
      .field('recordType',     'GENERAL')
      .attach('file', TEST_PDF, 'test.pdf');

    storedCID    = createRes.body.consultationCID;
    storedKeyRef = undefined; // missing

    const res = await supertest(app)
      .get(`/consultations/${CONS_ID}/document`)
      .set('Authorization', `Bearer ${doctorToken}`);

    expect(res.status).toBe(500);
    expect(res.body.status).toBe('FAILED');
  });
});
