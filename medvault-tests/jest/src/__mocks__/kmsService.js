/**
 * __mocks__/kmsService.js
 *
 * Matches the real kmsService.js API exactly:
 *   encryptDocument(fileBuffer) -> { encryptedBuffer, keyRef }
 *   decryptDocument(encryptedBuffer, keyRef, { actorID, actorRole, resourceID }) -> plaintext Buffer
 *   getKey(keyRef) -> { keyID, algorithm, status, createdAt }
 *   revokeKey(keyRef, { actorID, actorRole }) -> { keyID, status, auditID }
 *   destroyKey(keyRef, { actorID, actorRole }) -> { keyID, status, auditID }
 *
 * Deterministic in-memory round-trip so decryptDocument can recover
 * whatever encryptDocument produced within the same test run.
 */

'use strict';

let _keyCounter = 1;
const _store = new Map(); // keyRef -> plaintext Buffer
const _status = new Map(); // keyRef -> ACTIVE | REVOKED | DESTROYED

const encryptDocument = jest.fn(async (fileBuffer) => {
  if (!fileBuffer || fileBuffer.byteLength === 0) {
    throw new Error('Cannot encrypt empty buffer');
  }

  const keyRef = `KEY_MOCK_${String(_keyCounter++).padStart(4, '0')}`;
  _store.set(keyRef, fileBuffer);
  _status.set(keyRef, 'ACTIVE');

  const encryptedBuffer = Buffer.from(`ENCRYPTED::${keyRef}::${fileBuffer.toString('base64')}`);
  return { encryptedBuffer, keyRef };
});

const decryptDocument = jest.fn(async (encryptedBuffer, keyRef, context) => {
  if (!context || !context.actorID || !context.actorRole || !context.resourceID) {
    throw new Error('[KMS] Caller context required: actorID, actorRole and resourceID');
  }

  if (!keyRef) {
    throw new Error(`KMS decryption failed: unknown keyRef ${keyRef}`);
  }

  if (_status.has(keyRef) && _status.get(keyRef) !== 'ACTIVE') {
    throw new Error(`[KMS] Key ${keyRef} is not active (${_status.get(keyRef)})`);
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
    status:    _status.get(keyRef) || 'ACTIVE',
    createdAt: new Date().toISOString(),
  };
});

const revokeKey = jest.fn(async (keyRef, context) => {
  if (!context || !context.actorID || !context.actorRole) {
    throw new Error('[KMS] Caller context required: actorID and actorRole');
  }
  if (_status.get(keyRef) !== 'ACTIVE') {
    throw new Error(`[KMS] Key ${keyRef} cannot move from ${_status.get(keyRef)}`);
  }
  _status.set(keyRef, 'REVOKED');
  return { keyID: keyRef, status: 'REVOKED', auditID: 'AUDIT_MOCK' };
});

const destroyKey = jest.fn(async (keyRef, context) => {
  if (!context || !context.actorID || !context.actorRole) {
    throw new Error('[KMS] Caller context required: actorID and actorRole');
  }
  if (!['ACTIVE', 'REVOKED'].includes(_status.get(keyRef))) {
    throw new Error(`[KMS] Key ${keyRef} cannot move from ${_status.get(keyRef)}`);
  }
  _status.set(keyRef, 'DESTROYED');
  _store.delete(keyRef);
  return { keyID: keyRef, status: 'DESTROYED', auditID: 'AUDIT_MOCK' };
});

const __resetAll = () => {
  encryptDocument.mockClear();
  decryptDocument.mockClear();
  getKey.mockClear();
  revokeKey.mockClear();
  destroyKey.mockClear();
  _store.clear();
  _status.clear();
  _keyCounter = 1;
};

module.exports = { encryptDocument, decryptDocument, getKey, revokeKey, destroyKey, __resetAll };
