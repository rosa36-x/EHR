/**
 * __mocks__/kmsService.js
 *
 * Matches the real kmsService.js API exactly:
 *   encryptDocument(fileBuffer) -> { encryptedBuffer, keyRef }
 *   decryptDocument(encryptedBuffer, keyRef) -> plaintext Buffer
 *   getKey(keyRef) -> { keyID, algorithm, status, createdAt }
 *
 * Deterministic in-memory round-trip so decryptDocument can recover
 * whatever encryptDocument produced within the same test run.
 */

'use strict';

let _keyCounter = 1;
const _store = new Map(); // keyRef -> plaintext Buffer

const encryptDocument = jest.fn(async (fileBuffer) => {
  if (!fileBuffer || fileBuffer.byteLength === 0) {
    throw new Error('Cannot encrypt empty buffer');
  }

  const keyRef = `KEY_MOCK_${String(_keyCounter++).padStart(4, '0')}`;
  _store.set(keyRef, fileBuffer);

  const encryptedBuffer = Buffer.from(`ENCRYPTED::${keyRef}::${fileBuffer.toString('base64')}`);
  return { encryptedBuffer, keyRef };
});

const decryptDocument = jest.fn(async (encryptedBuffer, keyRef) => {
  if (!keyRef) {
    throw new Error(`KMS decryption failed: unknown keyRef ${keyRef}`);
  }

  if (_store.has(keyRef)) {
    return _store.get(keyRef);
  }

  // Fallback: decode from the mock ciphertext format directly, but only if
  // the keyRef embedded in the ciphertext actually matches the one given -
  // otherwise this would "succeed" even for a wrong/missing keyRef, which
  // defeats tests that verify decryption fails on a bad keyRef.
  const str = encryptedBuffer.toString();
  const parts = str.split('::');
  if (parts.length === 3 && parts[0] === 'ENCRYPTED' && parts[1] === keyRef) {
    return Buffer.from(parts[2], 'base64');
  }

  throw new Error(`KMS decryption failed: unknown keyRef ${keyRef}`);
});

const getKey = jest.fn(async (keyRef) => {
  if (!_store.has(keyRef)) {
    throw new Error(`[KMS] Key not found: ${keyRef}`);
  }
  return {
    keyID:     keyRef,
    algorithm: 'AES-256-GCM',
    status:    'ACTIVE',
    createdAt: new Date().toISOString(),
  };
});

const __resetAll = () => {
  encryptDocument.mockClear();
  decryptDocument.mockClear();
  getKey.mockClear();
  _store.clear();
  _keyCounter = 1;
};

module.exports = { encryptDocument, decryptDocument, getKey, __resetAll };
