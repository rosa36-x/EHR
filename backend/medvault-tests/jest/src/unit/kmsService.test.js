/**
 * unit/kmsService.test.js
 *
 * Tests the REAL kmsService (not the mock) to verify AES-256-GCM
 * encrypt → decrypt round-trips correctly, key refs are unique,
 * and decryption with the wrong key ref fails.
 */

'use strict';

// Point at the real service, not the mock
const kmsService = jest.requireActual('../../../backend/services/kmsService');

describe('kmsService — encrypt/decrypt round-trip', () => {
  const payload = Buffer.from('Sensitive patient record data — इलेक्ट्रॉनिक स्वास्थ्य रिकॉर्ड');

  test('generateKey returns a KEY-prefixed string', () => {
    const keyRef = kmsService.generateKey();
    expect(typeof keyRef).toBe('string');
    expect(keyRef).toMatch(/^KEY/);
  });

  test('generateKey produces unique refs on each call', () => {
    const refs = new Set(Array.from({ length: 50 }, () => kmsService.generateKey()));
    expect(refs.size).toBe(50);
  });

  test('encryptFile returns non-empty ciphertext and matching keyRef', async () => {
    const keyRef = kmsService.generateKey();
    const { ciphertext } = await kmsService.encryptFile(payload, keyRef);
    expect(Buffer.isBuffer(ciphertext)).toBe(true);
    expect(ciphertext.length).toBeGreaterThan(0);
    // Ciphertext must not equal plaintext
    expect(ciphertext.equals(payload)).toBe(false);
  });

  test('decryptFile recovers the original plaintext', async () => {
    const keyRef = kmsService.generateKey();
    const { ciphertext } = await kmsService.encryptFile(payload, keyRef);
    const decrypted = await kmsService.decryptFile(ciphertext, keyRef);
    expect(decrypted.equals(payload)).toBe(true);
  });

  test('decryptFile with wrong keyRef throws', async () => {
    const keyRef1 = kmsService.generateKey();
    const keyRef2 = kmsService.generateKey();
    const { ciphertext } = await kmsService.encryptFile(payload, keyRef1);
    await expect(kmsService.decryptFile(ciphertext, keyRef2)).rejects.toThrow();
  });

  test('encrypting same plaintext twice with same key produces different ciphertext (IV randomness)', async () => {
    const keyRef = kmsService.generateKey();
    const { ciphertext: ct1 } = await kmsService.encryptFile(payload, keyRef);
    const { ciphertext: ct2 } = await kmsService.encryptFile(payload, keyRef);
    expect(ct1.equals(ct2)).toBe(false);
  });

  test('empty buffer encrypts and decrypts cleanly', async () => {
    const keyRef = kmsService.generateKey();
    const empty  = Buffer.alloc(0);
    const { ciphertext } = await kmsService.encryptFile(empty, keyRef);
    const decrypted = await kmsService.decryptFile(ciphertext, keyRef);
    expect(decrypted.length).toBe(0);
  });
});
