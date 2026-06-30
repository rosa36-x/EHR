/**
 * unit/kmsService.test.js
 *
 * Tests the REAL kmsService (not the mock) to verify AES-256-GCM
 * encrypt → decrypt round-trips correctly, key refs are unique,
 * and decryption with the wrong key ref fails.
 *
 * Note: this service generates a fresh keyRef internally on every
 * encryptDocument() call — there is no separate generateKey() step
 * and no way to encrypt with a caller-supplied key reference.
 */

'use strict';

// Point at the real service, not the mock
const kmsService = jest.requireActual('../../../../backend/services/kmsService');

describe('kmsService — encrypt/decrypt round-trip', () => {
  const payload = Buffer.from('Sensitive patient record data — इलेक्ट्रॉनिक स्वास्थ्य रिकॉर्ड');

  test('encryptDocument returns a non-empty encryptedBuffer and a KEY-prefixed keyRef', async () => {
    const { encryptedBuffer, keyRef } = await kmsService.encryptDocument(payload);
    expect(Buffer.isBuffer(encryptedBuffer)).toBe(true);
    expect(encryptedBuffer.length).toBeGreaterThan(0);
    expect(typeof keyRef).toBe('string');
    expect(keyRef).toMatch(/^KEY/);
    // encryptedBuffer must not equal the raw plaintext
    expect(encryptedBuffer.equals(payload)).toBe(false);
  });

  test('encryptDocument produces unique keyRefs on each call', async () => {
    const results = await Promise.all(
      Array.from({ length: 50 }, () => kmsService.encryptDocument(payload))
    );
    const refs = new Set(results.map((r) => r.keyRef));
    expect(refs.size).toBe(50);
  });

  test('decryptDocument recovers the original plaintext', async () => {
    const { encryptedBuffer, keyRef } = await kmsService.encryptDocument(payload);
    const decrypted = await kmsService.decryptDocument(encryptedBuffer, keyRef);
    expect(decrypted.equals(payload)).toBe(true);
  });

  test('decryptDocument with the wrong keyRef throws', async () => {
    const first  = await kmsService.encryptDocument(payload);
    const second = await kmsService.encryptDocument(payload);
    await expect(
      kmsService.decryptDocument(first.encryptedBuffer, second.keyRef)
    ).rejects.toThrow();
  });

  test('encrypting the same plaintext twice produces different ciphertext (IV randomness)', async () => {
    const a = await kmsService.encryptDocument(payload);
    const b = await kmsService.encryptDocument(payload);
    expect(a.encryptedBuffer.equals(b.encryptedBuffer)).toBe(false);
  });

  test('encryptDocument rejects an empty buffer', async () => {
    // Source explicitly throws on empty/missing buffers rather than
    // silently encrypting zero bytes.
    await expect(kmsService.encryptDocument(Buffer.alloc(0))).rejects.toThrow(
      /empty buffer/i
    );
  });

  test('getKey returns metadata without exposing raw key bytes', async () => {
    const { keyRef } = await kmsService.encryptDocument(payload);
    const meta = await kmsService.getKey(keyRef);
    expect(meta.keyID).toBe(keyRef);
    expect(meta.algorithm).toBe('AES-256-GCM');
    expect(meta.status).toBe('ACTIVE');
    expect(typeof meta.createdAt).toBe('string');
    expect(meta).not.toHaveProperty('key');
  });

  test('getKey throws for an unknown keyRef', async () => {
    await expect(kmsService.getKey('KEY9999')).rejects.toThrow(/not found/i);
  });
});
