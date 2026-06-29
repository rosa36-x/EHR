/**
 * integration/ipfsKmsRoundTrip.test.js
 *
 * Verifies that:
 *   1. Uploading a consultation stores a CID and a KMS keyRef on the ledger
 *   2. Downloading the document decrypts via KMS and returns the original file
 *   3. A missing / corrupted CID returns a 500 with a meaningful error
 *   4. A missing KMS keyRef returns a 500 with a meaningful error
 *
 * The IPFS and KMS mocks track calls, so we can assert that:
 *   - uploadToIPFS was called with the encrypted buffer
 *   - decryptFile was called with the correct keyRef on download
 */

'use strict';

jest.mock('../../../backend/services/fabricService',      () => require('../__mocks__/fabricService'));
jest.mock('../../../backend/services/notificationService',() => require('../__mocks__/notificationService'));

// Use the REAL ipfsService and kmsService mocks (not jest.requireActual),
// so we can inspect calls while avoiding a live IPFS/KMS dependency.
jest.mock('../../../backend/services/ipfsService', () => require('../__mocks__/ipfsService'));
jest.mock('../../../backend/services/kmsService',  () => require('../__mocks__/kmsService'));

const supertest  = require('supertest');
const app        = require('../../../backend/server');
const { makeToken } = require('../helpers');
const ipfsMock   = require('../../../backend/services/ipfsService');
const kmsMock    = require('../../../backend/services/kmsService');
const fabricMock = require('../../../backend/services/fabricService');

process.env.MONGODB_URI = process.env.MONGODB_URI_TEST || 'mongodb://localhost:27017/medvault_test';

const DOCTOR_ID  = 'DOC_IPFS_001';
const PATIENT_ID = 'PAT_IPFS_001';
const doctorToken = makeToken('doctor', DOCTOR_ID);
const TEST_PDF    = Buffer.from('%PDF-1.4 test consultation document');

const CONS_ID     = 'CONS_IPFS_ROUNDTRIP_001';
let storedCID;
let storedKeyRef;

beforeAll(() => {
  // createConsultation returns CID and keyRef
  fabricMock.createConsultation.mockImplementation(async (data) => {
    storedCID    = `bafymock_ipfs_${Date.now()}`;
    storedKeyRef = `KEY_IPFS_${Date.now()}`;
    return {
      status:           'SUCCESS',
      consultationID:   data.consultationID,
      consultationCID:  storedCID,
      encryptionKeyRef: storedKeyRef,
      sensitivityLevel: 'NORMAL',
    };
  });

  // getConsultation returns the stored CID and keyRef
  fabricMock.getConsultation.mockImplementation(async (id) => ({
    status: 'SUCCESS',
    data: {
      consultationID:   id,
      patientID:        PATIENT_ID,
      sensitivityLevel: 'NORMAL',
      consultationCID:  storedCID,
      encryptionKeyRef: storedKeyRef,
    },
  }));
});

afterEach(() => {
  ipfsMock.__resetAll();
  kmsMock.__resetAll();
});

describe('IPFS + KMS round-trip via consultation route', () => {
  test('POST /consultations — uploadToIPFS called, CID stored', async () => {
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

    // IPFS upload was called with a Buffer (the encrypted file)
    expect(ipfsMock.uploadToIPFS).toHaveBeenCalledTimes(1);
    const uploadArg = ipfsMock.uploadToIPFS.mock.calls[0][0];
    expect(Buffer.isBuffer(uploadArg)).toBe(true);

    // KMS encryptFile was called
    expect(kmsMock.encryptFile).toHaveBeenCalledTimes(1);
  });

  test('GET /consultations/:id/document — decryptFile called with correct keyRef', async () => {
    // First create so storedCID/storedKeyRef are populated
    await supertest(app)
      .post('/consultations')
      .set('Authorization', `Bearer ${doctorToken}`)
      .field('consultationID', CONS_ID)
      .field('patientID',      PATIENT_ID)
      .field('doctorID',       DOCTOR_ID)
      .field('diagnosis',      'Checkup for download test')
      .field('recordType',     'GENERAL')
      .attach('file', TEST_PDF, 'test.pdf');

    ipfsMock.__resetAll();
    kmsMock.__resetAll();

    const res = await supertest(app)
      .get(`/consultations/${CONS_ID}/document`)
      .set('Authorization', `Bearer ${doctorToken}`);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/pdf');

    // downloadFromIPFS and decryptFile must both have been called
    expect(ipfsMock.downloadFromIPFS).toHaveBeenCalledTimes(1);
    expect(kmsMock.decryptFile).toHaveBeenCalledTimes(1);

    // decryptFile must have received the correct keyRef
    const [, keyRefArg] = kmsMock.decryptFile.mock.calls[0];
    expect(keyRefArg).toBe(storedKeyRef);
  });

  test('GET /consultations/:id/document — invalid CID → 500', async () => {
    ipfsMock.downloadFromIPFS.mockRejectedValueOnce(
      new Error('Invalid CID: notavalidcid12345')
    );
    fabricMock.getConsultation.mockResolvedValueOnce({
      status: 'SUCCESS',
      data: {
        consultationID:   CONS_ID,
        patientID:        PATIENT_ID,
        sensitivityLevel: 'NORMAL',
        consultationCID:  'notavalidcid12345',
        encryptionKeyRef: storedKeyRef,
      },
    });

    const res = await supertest(app)
      .get(`/consultations/${CONS_ID}/document`)
      .set('Authorization', `Bearer ${doctorToken}`);

    expect(res.status).toBe(500);
    expect(res.body.status).toBe('FAILED');
  });

  test('GET /consultations/:id/document — missing keyRef → 500', async () => {
    kmsMock.decryptFile.mockRejectedValueOnce(
      new Error('KMS decryption failed: unknown keyRef undefined')
    );
    fabricMock.getConsultation.mockResolvedValueOnce({
      status: 'SUCCESS',
      data: {
        consultationID:   CONS_ID,
        patientID:        PATIENT_ID,
        sensitivityLevel: 'NORMAL',
        consultationCID:  storedCID,
        encryptionKeyRef: undefined, // missing
      },
    });

    const res = await supertest(app)
      .get(`/consultations/${CONS_ID}/document`)
      .set('Authorization', `Bearer ${doctorToken}`);

    expect(res.status).toBe(500);
    expect(res.body.status).toBe('FAILED');
  });
});
