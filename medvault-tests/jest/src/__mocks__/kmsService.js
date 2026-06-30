/**
 * __mocks__/kmsService.js
 *
 * Replaces AES-256-GCM KMS with deterministic in-memory stubs for unit tests.
 * generateKey  → returns 'KEY_MOCK_<n>'
 * encryptFile  → returns { ciphertext, keyRef }
 * decryptFile  → returns the original plaintext buffer
 */

'use strict';

let _keyCounter = 1;
// In-memory store: keyRef → plaintext (so decrypt can round-trip)
const _store = new Map();

const generateKey = jest.fn(() => {
  return `KEY_MOCK_${String(_keyCounter++).padStart(4, '0')}`;
});

const encryptFile = jest.fn(async (buffer, keyRef) => {
  _store.set(keyRef, buffer);
  return {
    ciphertext: Buffer.from(`ENCRYPTED::${keyRef}::${buffer.toString('base64')}`),
    keyRef,
  };
});

const decryptFile = jest.fn(async (ciphertext, keyRef) => {
  if (_store.has(keyRef)) {
    return _store.get(keyRef);
  }
  // Fallback: decode from the mock ciphertext format
  const str = ciphertext.toString();
  const parts = str.split('::');
  if (parts.length === 3 && parts[0] === 'ENCRYPTED') {
    return Buffer.from(parts[2], 'base64');
  }
  throw new Error(`KMS decryption failed: unknown keyRef ${keyRef}`);
});

const __resetAll = () => {
  generateKey.mockClear();
  encryptFile.mockClear();
  decryptFile.mockClear();
  _store.clear();
  _keyCounter = 1;
};

module.exports = { generateKey, encryptFile, decryptFile, __resetAll };
