/**
 * unit/kmsService.test.js
 *
 * Tests the REAL kmsService (not the mock): AES-256-GCM round trips, unique
 * keyRefs, KEK wrapping on disk, fail-closed store loading, caller context and
 * release logging, revoke/destroy, and KEK rotation.
 *
 * This service generates a fresh keyRef internally on every encryptDocument()
 * call - there is no way to encrypt with a caller-supplied key reference.
 */

'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const KMS_STORE_PATH = path.resolve('./data/kms_store.json'); // same as kmsService.js
const RELEASE_LOG_PATH = path.resolve('./data/kms_release_log.jsonl');

const KEK = crypto.randomBytes(32).toString('hex');
process.env.KMS_KEK = KEK;
delete process.env.KMS_KEK_FILE;

const mockLogAudit = jest.fn(async () => 'AUDIT_TEST_001');
jest.mock('../../../../backend/services/auditMiddleware', () => ({
  logAudit: (...args) => mockLogAudit(...args),
}));

const loadKms = () => {
  jest.resetModules();
  return jest.requireActual('../../../../backend/services/kmsService');
};

const resetFiles = () => {
  fs.mkdirSync(path.dirname(KMS_STORE_PATH), { recursive: true });
  fs.writeFileSync(KMS_STORE_PATH, JSON.stringify({ version: 2, keys: {} }));
  fs.rmSync(RELEASE_LOG_PATH, { force: true });
};

const readLog = () =>
  fs.existsSync(RELEASE_LOG_PATH)
    ? fs.readFileSync(RELEASE_LOG_PATH, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
    : [];

const ctx = { actorID: 'DOC_KMS_001', actorRole: 'doctor', resourceID: 'RX_KMS_001' };
const admin = { actorID: 'GOV_ADMIN_001', actorRole: 'admin' };
const payload = Buffer.from('Sensitive patient record data');

let kmsService;

beforeEach(() => {
  resetFiles();
  process.env.KMS_KEK = KEK;
  delete process.env.KMS_KEK_FILE;
  mockLogAudit.mockClear();
  kmsService = loadKms();
});

afterAll(() => {
  resetFiles();
});

describe('kmsService - encrypt/decrypt round-trip', () => {
  test('encryptDocument returns a non-empty encryptedBuffer and a KEY-prefixed keyRef', async () => {
    const { encryptedBuffer, keyRef } = await kmsService.encryptDocument(payload);
    expect(Buffer.isBuffer(encryptedBuffer)).toBe(true);
    expect(encryptedBuffer.length).toBeGreaterThan(0);
    expect(keyRef).toMatch(/^KEY/);
    expect(encryptedBuffer.equals(payload)).toBe(false);
  });

  test('encryptDocument produces unique keyRefs on each call', async () => {
    const results = await Promise.all(
      Array.from({ length: 50 }, () => kmsService.encryptDocument(payload))
    );
    expect(new Set(results.map((r) => r.keyRef)).size).toBe(50);
  });

  test('decryptDocument recovers the original plaintext', async () => {
    const { encryptedBuffer, keyRef } = await kmsService.encryptDocument(payload);
    const decrypted = await kmsService.decryptDocument(encryptedBuffer, keyRef, ctx);
    expect(decrypted.equals(payload)).toBe(true);
  });

  test('decryptDocument with the wrong keyRef throws', async () => {
    const first = await kmsService.encryptDocument(payload);
    const second = await kmsService.encryptDocument(payload);
    await expect(
      kmsService.decryptDocument(first.encryptedBuffer, second.keyRef, ctx)
    ).rejects.toThrow();
  });

  test('encrypting the same plaintext twice produces different ciphertext (IV randomness)', async () => {
    const a = await kmsService.encryptDocument(payload);
    const b = await kmsService.encryptDocument(payload);
    expect(a.encryptedBuffer.equals(b.encryptedBuffer)).toBe(false);
  });

  test('encryptDocument rejects an empty buffer', async () => {
    await expect(kmsService.encryptDocument(Buffer.alloc(0))).rejects.toThrow(/empty buffer/i);
  });

  test('getKey returns metadata without exposing key material', async () => {
    const { keyRef } = await kmsService.encryptDocument(payload);
    const meta = await kmsService.getKey(keyRef);
    expect(meta.keyID).toBe(keyRef);
    expect(meta.algorithm).toBe('AES-256-GCM');
    expect(meta.status).toBe('ACTIVE');
    expect(typeof meta.createdAt).toBe('string');
    expect(meta).not.toHaveProperty('key');
    expect(meta).not.toHaveProperty('wrapped');
  });

  test('getKey throws for an unknown keyRef', async () => {
    await expect(kmsService.getKey('KEY9999')).rejects.toThrow(/not found/i);
  });
});

describe('kmsService - KEK wrapping and store persistence', () => {
  test('the store never contains a raw data key', async () => {
    const { keyRef } = await kmsService.encryptDocument(payload);
    const onDisk = JSON.parse(fs.readFileSync(KMS_STORE_PATH, 'utf8'));
    expect(onDisk.version).toBe(2);
    const record = onDisk.keys[keyRef];
    expect(record).not.toHaveProperty('key');
    expect(record.wrapped).toMatch(/^[0-9a-f]{120}$/); // IV 12 + tag 16 + DEK 32 bytes
  });

  test('the store file is written with 0600 permissions', async () => {
    if (process.platform === 'win32') return;
    await kmsService.encryptDocument(payload);
    expect(fs.statSync(KMS_STORE_PATH).mode & 0o777).toBe(0o600);
  });

  test('no temp files are left behind after a write', async () => {
    await kmsService.encryptDocument(payload);
    const leftovers = fs.readdirSync(path.dirname(KMS_STORE_PATH)).filter((f) => f.endsWith('.tmp'));
    expect(leftovers).toEqual([]);
  });

  test('keys survive a restart and the counter does not reuse a keyRef', async () => {
    const first = await kmsService.encryptDocument(payload);
    kmsService = loadKms();
    expect((await kmsService.decryptDocument(first.encryptedBuffer, first.keyRef, ctx)).equals(payload)).toBe(true);
    const second = await kmsService.encryptDocument(payload);
    expect(second.keyRef).not.toBe(first.keyRef);
  });

  test('a different KEK cannot unwrap the stored keys', async () => {
    const { encryptedBuffer, keyRef } = await kmsService.encryptDocument(payload);
    process.env.KMS_KEK = crypto.randomBytes(32).toString('hex');
    kmsService = loadKms();
    await expect(kmsService.decryptDocument(encryptedBuffer, keyRef, ctx)).rejects.toThrow();
  });

  test('KMS_KEK_FILE takes precedence over KMS_KEK', async () => {
    const kekFile = path.resolve('./data/test_kek.hex');
    fs.writeFileSync(kekFile, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
    try {
      process.env.KMS_KEK_FILE = kekFile;
      kmsService = loadKms();
      const { encryptedBuffer, keyRef } = await kmsService.encryptDocument(payload);
      delete process.env.KMS_KEK_FILE; // falls back to a different KEK
      kmsService = loadKms();
      await expect(kmsService.decryptDocument(encryptedBuffer, keyRef, ctx)).rejects.toThrow();
    } finally {
      fs.rmSync(kekFile, { force: true });
    }
  });

  test('encryption fails closed when no KEK is configured', async () => {
    delete process.env.KMS_KEK;
    kmsService = loadKms();
    await expect(kmsService.encryptDocument(payload)).rejects.toThrow(/No KEK configured/);
  });

  test('a malformed KEK is rejected', async () => {
    process.env.KMS_KEK = 'not-hex';
    kmsService = loadKms();
    await expect(kmsService.encryptDocument(payload)).rejects.toThrow(/64 hex/);
  });
});

describe('kmsService - fail-closed store loading', () => {
  test('a corrupt store file throws and is not overwritten', async () => {
    const { keyRef } = await kmsService.encryptDocument(payload);
    fs.writeFileSync(KMS_STORE_PATH, '{ this is not json');
    kmsService = loadKms();
    await expect(kmsService.encryptDocument(payload)).rejects.toThrow(/unreadable/i);
    expect(fs.readFileSync(KMS_STORE_PATH, 'utf8')).toBe('{ this is not json');
    expect(keyRef).toBeDefined();
  });

  test('an empty (zero-byte) store file throws', async () => {
    fs.writeFileSync(KMS_STORE_PATH, '');
    kmsService = loadKms();
    await expect(kmsService.encryptDocument(payload)).rejects.toThrow(/unreadable/i);
  });

  test('a legacy plaintext store is refused until migrated', async () => {
    fs.writeFileSync(
      KMS_STORE_PATH,
      JSON.stringify({ KEY0001: { keyID: 'KEY0001', key: 'ab'.repeat(32), algorithm: 'AES-256-GCM', status: 'ACTIVE', createdAt: new Date().toISOString() } })
    );
    kmsService = loadKms();
    await expect(kmsService.encryptDocument(payload)).rejects.toThrow(/legacy plaintext/i);
  });

  test('a tampered record is rejected', async () => {
    const { keyRef } = await kmsService.encryptDocument(payload);
    const onDisk = JSON.parse(fs.readFileSync(KMS_STORE_PATH, 'utf8'));
    onDisk.keys[keyRef].wrapped = 'zz';
    fs.writeFileSync(KMS_STORE_PATH, JSON.stringify(onDisk));
    kmsService = loadKms();
    await expect(kmsService.getKey(keyRef)).rejects.toThrow(/Corrupt key store/);
  });

  test('a wrapped key cannot be moved to a different keyRef', async () => {
    const a = await kmsService.encryptDocument(payload);
    const b = await kmsService.encryptDocument(payload);
    const onDisk = JSON.parse(fs.readFileSync(KMS_STORE_PATH, 'utf8'));
    onDisk.keys[b.keyRef].wrapped = onDisk.keys[a.keyRef].wrapped;
    fs.writeFileSync(KMS_STORE_PATH, JSON.stringify(onDisk));
    kmsService = loadKms();
    await expect(kmsService.decryptDocument(b.encryptedBuffer, b.keyRef, ctx)).rejects.toThrow();
  });
});

describe('kmsService - caller context and release log', () => {
  test('decryptDocument without a context is refused and logged', async () => {
    const { encryptedBuffer, keyRef } = await kmsService.encryptDocument(payload);
    await expect(kmsService.decryptDocument(encryptedBuffer, keyRef)).rejects.toThrow(/Caller context required/);
    const log = readLog();
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ event: 'KEY_RELEASE_DENIED', keyRef, reason: 'NO_CONTEXT' });
  });

  test.each(['actorID', 'actorRole', 'resourceID'])('a context missing %s is refused', async (field) => {
    const { encryptedBuffer, keyRef } = await kmsService.encryptDocument(payload);
    const partial = { ...ctx, [field]: '' };
    await expect(kmsService.decryptDocument(encryptedBuffer, keyRef, partial)).rejects.toThrow(/Caller context required/);
  });

  test('every successful release is logged with the caller context', async () => {
    const { encryptedBuffer, keyRef } = await kmsService.encryptDocument(payload);
    await kmsService.decryptDocument(encryptedBuffer, keyRef, ctx);
    await kmsService.decryptDocument(encryptedBuffer, keyRef, { ...ctx, actorID: 'PHARM_001', actorRole: 'pharmacist' });
    const log = readLog();
    expect(log).toHaveLength(2);
    expect(log[0]).toMatchObject({ event: 'KEY_RELEASE', keyRef, actorID: 'DOC_KMS_001', actorRole: 'doctor', resourceID: 'RX_KMS_001' });
    expect(log[1]).toMatchObject({ event: 'KEY_RELEASE', keyRef, actorID: 'PHARM_001', actorRole: 'pharmacist' });
    expect(typeof log[0].ts).toBe('string');
  });

  test('a failed decrypt is logged as denied and releases nothing', async () => {
    const first = await kmsService.encryptDocument(payload);
    const second = await kmsService.encryptDocument(payload);
    await expect(kmsService.decryptDocument(first.encryptedBuffer, second.keyRef, ctx)).rejects.toThrow();
    const log = readLog();
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ event: 'KEY_RELEASE_DENIED', reason: 'DECRYPT_FAILED' });
  });

  test('no plaintext is returned if the release log cannot be written', async () => {
    const { encryptedBuffer, keyRef } = await kmsService.encryptDocument(payload);
    fs.rmSync(RELEASE_LOG_PATH, { force: true });
    fs.mkdirSync(RELEASE_LOG_PATH); // a directory where the log file should be
    try {
      await expect(kmsService.decryptDocument(encryptedBuffer, keyRef, ctx)).rejects.toThrow(/Release log write failed/);
    } finally {
      fs.rmdirSync(RELEASE_LOG_PATH);
    }
  });

  test('the release log never contains key material', async () => {
    const { encryptedBuffer, keyRef } = await kmsService.encryptDocument(payload);
    await kmsService.decryptDocument(encryptedBuffer, keyRef, ctx);
    const onDisk = JSON.parse(fs.readFileSync(KMS_STORE_PATH, 'utf8'));
    const raw = fs.readFileSync(RELEASE_LOG_PATH, 'utf8');
    expect(raw).not.toContain(onDisk.keys[keyRef].wrapped);
  });
});

describe('kmsService - revoke and destroy', () => {
  test('a revoked key can no longer be released and is logged', async () => {
    const { encryptedBuffer, keyRef } = await kmsService.encryptDocument(payload);
    const res = await kmsService.revokeKey(keyRef, admin);
    expect(res).toEqual({ keyID: keyRef, status: 'REVOKED', auditID: 'AUDIT_TEST_001' });
    expect(mockLogAudit).toHaveBeenCalledWith(expect.objectContaining({
      actorID: 'GOV_ADMIN_001', action: 'KEY_REVOKE', resourceType: 'KMS_KEY', resourceID: keyRef,
    }));

    await expect(kmsService.decryptDocument(encryptedBuffer, keyRef, ctx)).rejects.toThrow(/not active \(REVOKED\)/);
    expect(readLog().pop()).toMatchObject({ event: 'KEY_RELEASE_DENIED', reason: 'REVOKED' });
    expect((await kmsService.getKey(keyRef)).revokedAt).toBeDefined();
  });

  test('destroyKey removes the key material and the document is unrecoverable', async () => {
    const { encryptedBuffer, keyRef } = await kmsService.encryptDocument(payload);
    const res = await kmsService.destroyKey(keyRef, admin);
    expect(res.status).toBe('DESTROYED');
    expect(mockLogAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'KEY_DESTROY', resourceID: keyRef }));

    const record = JSON.parse(fs.readFileSync(KMS_STORE_PATH, 'utf8')).keys[keyRef];
    expect(record.status).toBe('DESTROYED');
    expect(record).not.toHaveProperty('wrapped');

    kmsService = loadKms();
    await expect(kmsService.decryptDocument(encryptedBuffer, keyRef, ctx)).rejects.toThrow(/not active \(DESTROYED\)/);
  });

  test('a revoked key can be destroyed, but a destroyed key cannot be revoked or destroyed again', async () => {
    const { keyRef } = await kmsService.encryptDocument(payload);
    await kmsService.revokeKey(keyRef, admin);
    await kmsService.destroyKey(keyRef, admin);
    await expect(kmsService.revokeKey(keyRef, admin)).rejects.toThrow(/cannot move from DESTROYED/);
    await expect(kmsService.destroyKey(keyRef, admin)).rejects.toThrow(/cannot move from DESTROYED/);
  });

  test('a destroyed keyRef is never reused after restart', async () => {
    const { keyRef } = await kmsService.encryptDocument(payload);
    await kmsService.destroyKey(keyRef, admin);
    kmsService = loadKms();
    const next = await kmsService.encryptDocument(payload);
    expect(next.keyRef).not.toBe(keyRef);
  });

  test('revoke and destroy require an actor and reject unknown keys', async () => {
    const { keyRef } = await kmsService.encryptDocument(payload);
    await expect(kmsService.revokeKey(keyRef)).rejects.toThrow(/Caller context required/);
    await expect(kmsService.destroyKey(keyRef, { actorID: 'x' })).rejects.toThrow(/Caller context required/);
    await expect(kmsService.revokeKey('KEY9999', admin)).rejects.toThrow(/not found/i);
  });

  test('a failed audit write does not undo the state change', async () => {
    mockLogAudit.mockRejectedValueOnce(new Error('ledger down'));
    const { keyRef } = await kmsService.encryptDocument(payload);
    const res = await kmsService.revokeKey(keyRef, admin);
    expect(res.status).toBe('REVOKED');
    expect(res.auditID).toBeNull();
  });
});

describe('kmsService - KEK rotation', () => {
  test('rewrapAllKeys moves every key to the new KEK without changing keyRefs', async () => {
    const docs = [];
    for (let i = 0; i < 3; i++) docs.push({ ...(await kmsService.encryptDocument(payload)) });
    const destroyed = await kmsService.encryptDocument(payload);
    await kmsService.destroyKey(destroyed.keyRef, admin);
    const wrappedBefore = JSON.parse(fs.readFileSync(KMS_STORE_PATH, 'utf8')).keys[docs[0].keyRef].wrapped;

    const newKek = crypto.randomBytes(32);
    const count = kmsService.rewrapAllKeys(kmsService.loadKek(), newKek);
    expect(count).toBe(3);

    const after = JSON.parse(fs.readFileSync(KMS_STORE_PATH, 'utf8')).keys;
    expect(after[docs[0].keyRef].wrapped).not.toBe(wrappedBefore);
    expect(after[destroyed.keyRef].status).toBe('DESTROYED');

    process.env.KMS_KEK = newKek.toString('hex');
    kmsService = loadKms();
    for (const d of docs) {
      expect((await kmsService.decryptDocument(d.encryptedBuffer, d.keyRef, ctx)).equals(payload)).toBe(true);
    }

    process.env.KMS_KEK = KEK; // the old KEK no longer works
    kmsService = loadKms();
    await expect(kmsService.decryptDocument(docs[0].encryptedBuffer, docs[0].keyRef, ctx)).rejects.toThrow();
  });

  test('rewrapAllKeys with the wrong old KEK changes nothing', async () => {
    const { encryptedBuffer, keyRef } = await kmsService.encryptDocument(payload);
    const before = fs.readFileSync(KMS_STORE_PATH, 'utf8');
    expect(() => kmsService.rewrapAllKeys(crypto.randomBytes(32), crypto.randomBytes(32))).toThrow();
    expect(fs.readFileSync(KMS_STORE_PATH, 'utf8')).toBe(before);
    expect((await kmsService.decryptDocument(encryptedBuffer, keyRef, ctx)).equals(payload)).toBe(true);
  });
});

describe('kmsService - legacy store migration', () => {
  const legacyKey = crypto.randomBytes(32);
  const legacyStore = () => JSON.stringify({
    KEY0001: { keyID: 'KEY0001', key: legacyKey.toString('hex'), algorithm: 'AES-256-GCM', status: 'ACTIVE', createdAt: '2026-01-01T00:00:00.000Z' },
  });
  const legacyCiphertext = () => {
    const iv = crypto.randomBytes(12);
    const c = crypto.createCipheriv('aes-256-gcm', legacyKey, iv);
    const enc = Buffer.concat([c.update(payload), c.final()]);
    return Buffer.concat([iv, c.getAuthTag(), enc]);
  };

  afterEach(() => {
    for (const f of fs.readdirSync(path.dirname(KMS_STORE_PATH))) {
      if (f.includes('.legacy-')) fs.rmSync(path.join(path.dirname(KMS_STORE_PATH), f), { force: true });
    }
  });

  test('migrateLegacyStore wraps existing keys, keeps keyRefs and old documents stay readable', async () => {
    const ciphertext = legacyCiphertext();
    fs.writeFileSync(KMS_STORE_PATH, legacyStore());

    const { migrated, backupPath } = kmsService.migrateLegacyStore(kmsService.loadKek());
    expect(migrated).toBe(1);
    expect(fs.existsSync(backupPath)).toBe(true);
    if (process.platform !== 'win32') expect(fs.statSync(backupPath).mode & 0o777).toBe(0o600);

    const onDisk = JSON.parse(fs.readFileSync(KMS_STORE_PATH, 'utf8'));
    expect(onDisk.version).toBe(2);
    expect(onDisk.keys.KEY0001).not.toHaveProperty('key');
    expect(onDisk.keys.KEY0001.createdAt).toBe('2026-01-01T00:00:00.000Z');

    kmsService = loadKms();
    expect((await kmsService.decryptDocument(ciphertext, 'KEY0001', ctx)).equals(payload)).toBe(true);
    expect((await kmsService.encryptDocument(payload)).keyRef).toBe('KEY0002');
  });

  test('migrateLegacyStore can skip the plaintext backup', () => {
    fs.writeFileSync(KMS_STORE_PATH, legacyStore());
    const { backupPath } = kmsService.migrateLegacyStore(kmsService.loadKek(), { backup: false });
    expect(backupPath).toBeNull();
  });

  test('migrateLegacyStore refuses an already-migrated store', async () => {
    await kmsService.encryptDocument(payload);
    expect(() => kmsService.migrateLegacyStore(kmsService.loadKek())).toThrow(/already/i);
  });
});
