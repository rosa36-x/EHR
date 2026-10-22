import crypto from "crypto";
import fs from "fs";
import path from "path";

/**
 * Envelope-encryption key service.
 *
 * Each document is encrypted under its own random 256-bit data key (DEK).
 * DEKs are never stored in the clear: they are wrapped (AES-256-GCM) under a
 * key-encryption key (KEK) supplied from outside the repository, either as
 * KMS_KEK_FILE (path to a file containing 64 hex chars) or KMS_KEK (64 hex).
 *
 * Store:    backend/data/kms_store.json         (wrapped DEKs + key status)
 * Release:  backend/data/kms_release_log.jsonl  (append-only: one line per key release or
 *           refused release, plus KEY_REVOKE / KEY_DESTROY lifecycle events)
 *
 * Store layout:
 * {
 *   "version": 2,
 *   "keys": {
 *     "KEY0001": { "keyID", "algorithm", "status", "createdAt", "wrapped" },
 *     ...
 *   }
 * }
 * status is ACTIVE, REVOKED or DESTROYED. A DESTROYED record keeps no key
 * material and remains in the store so a keyRef is never reused.
 */
const KMS_STORE_PATH  = path.resolve("./data/kms_store.json");
const KMS_RELEASE_LOG = path.resolve("./data/kms_release_log.jsonl");

const STORE_VERSION = 2;
const ALGORITHM     = "AES-256-GCM";
const STATUSES      = new Set(["ACTIVE", "REVOKED", "DESTROYED"]);
const WRAPPED_BYTES = 12 + 16 + 32; // IV | authTag | wrapped DEK

// ── KEK handling ──────────────────────────────────────────────────────────────

export function parseKek(hex) {
    if (typeof hex !== "string" || !/^[0-9a-fA-F]{64}$/.test(hex.trim())) {
        throw new Error("[KMS] KEK must be 64 hex characters (32 bytes)");
    }
    return Buffer.from(hex.trim(), "hex");
}

/**
 * Read the KEK from KMS_KEK_FILE (preferred) or KMS_KEK.
 * Never falls back silently: a configured but unreadable file is an error.
 */
export function loadKek() {
    const file = process.env.KMS_KEK_FILE;

    if (file) {
        let contents;
        try {
            const st = fs.statSync(file);
            if (process.platform !== "win32" && (st.mode & 0o077) !== 0) {
                console.warn(`[KMS] KEK file ${file} is accessible to other users; restrict it to 0600.`);
            }
            contents = fs.readFileSync(file, "utf8");
        } catch (err) {
            throw new Error(`[KMS] Cannot read KEK file: ${err.message}`);
        }
        return parseKek(contents);
    }

    if (process.env.KMS_KEK) {
        return parseKek(process.env.KMS_KEK);
    }

    throw new Error("[KMS] No KEK configured: set KMS_KEK_FILE or KMS_KEK");
}

let cachedKek = null;

function getKek() {
    if (!cachedKek) cachedKek = loadKek();
    return cachedKek;
}

export function wrapDek(dek, kek, keyRef) {
    const iv     = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", kek, iv);
    cipher.setAAD(Buffer.from(keyRef, "utf8"));
    const wrapped = Buffer.concat([cipher.update(dek), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), wrapped]).toString("hex");
}

export function unwrapDek(wrappedHex, kek, keyRef) {
    const buf = Buffer.from(wrappedHex, "hex");
    if (buf.length !== WRAPPED_BYTES) {
        throw new Error(`[KMS] Malformed wrapped key for ${keyRef}`);
    }
    const decipher = crypto.createDecipheriv("aes-256-gcm", kek, buf.subarray(0, 12));
    decipher.setAAD(Buffer.from(keyRef, "utf8"));
    decipher.setAuthTag(buf.subarray(12, 28));
    return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]);
}

// ── Persistence ───────────────────────────────────────────────────────────────

function writeFileAtomic(target, data) {
    const dir = path.dirname(target);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });

    const tmp = path.join(
        dir,
        `.${path.basename(target)}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`
    );

    let fd;
    try {
        fd = fs.openSync(tmp, "wx", 0o600);
        fs.writeFileSync(fd, data, "utf8");
        fs.fsyncSync(fd);
        fs.closeSync(fd);
        fd = undefined;
        fs.renameSync(tmp, target);
    } catch (err) {
        if (fd !== undefined) {
            try { fs.closeSync(fd); } catch { /* ignore */ }
        }
        try { fs.unlinkSync(tmp); } catch { /* ignore */ }
        throw err;
    }
}

function validateRecord(keyRef, record) {
    if (!record || typeof record !== "object" || record.keyID !== keyRef) {
        throw new Error(`[KMS] Corrupt key store: bad record for ${keyRef}`);
    }
    if (!STATUSES.has(record.status)) {
        throw new Error(`[KMS] Corrupt key store: bad status for ${keyRef}`);
    }
    if (record.status === "DESTROYED") {
        if (record.wrapped !== undefined) {
            throw new Error(`[KMS] Corrupt key store: destroyed key ${keyRef} still holds key material`);
        }
    } else if (typeof record.wrapped !== "string" || !/^[0-9a-f]+$/.test(record.wrapped) || record.wrapped.length !== WRAPPED_BYTES * 2) {
        throw new Error(`[KMS] Corrupt key store: bad wrapped key for ${keyRef}`);
    }
}

/**
 * Read and validate the key store file. A missing file means a fresh store;
 * any other problem throws, so keys are never silently replaced by an empty store.
 */
function readStoreFile() {
    if (!fs.existsSync(KMS_STORE_PATH)) {
        console.log("[KMS] No existing key store found, starting fresh.");
        return new Map();
    }

    let parsed;
    try {
        parsed = JSON.parse(fs.readFileSync(KMS_STORE_PATH, "utf8"));
    } catch (err) {
        throw new Error(`[KMS] Key store unreadable (${err.message}); refusing to continue with an empty store`);
    }

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("[KMS] Key store has an unexpected structure; refusing to continue");
    }

    if (parsed.version === STORE_VERSION && parsed.keys && typeof parsed.keys === "object") {
        const store = new Map();
        for (const [keyRef, record] of Object.entries(parsed.keys)) {
            validateRecord(keyRef, record);
            store.set(keyRef, record);
        }
        console.log(`[KMS] Loaded ${store.size} key record(s) from disk.`);
        return store;
    }

    if (Object.keys(parsed).length === 0) {
        return new Map();
    }

    throw new Error("[KMS] Key store is in the legacy plaintext format; run scripts/migrateKmsStore.js first");
}

function writeStoreFile(store) {
    const keys = {};
    for (const [keyRef, record] of store.entries()) keys[keyRef] = record;
    writeFileAtomic(KMS_STORE_PATH, JSON.stringify({ version: STORE_VERSION, keys }, null, 2));
}

function deriveCounter(store) {
    let max = 0;
    for (const keyRef of store.keys()) {
        const n = parseInt(keyRef.replace("KEY", ""), 10);
        if (!isNaN(n) && n > max) max = n;
    }
    return max + 1;
}

let keyStore   = null;
let keyCounter = 1;

function getStore() {
    if (!keyStore) {
        const loaded = readStoreFile();
        keyStore   = loaded;
        keyCounter = deriveCounter(loaded);
    }
    return keyStore;
}

function generateKeyRef() {
    const ref = `KEY${String(keyCounter).padStart(4, "0")}`;
    keyCounter++;
    return ref;
}

// ── Release log ───────────────────────────────────────────────────────────────

function appendReleaseLog(entry) {
    fs.mkdirSync(path.dirname(KMS_RELEASE_LOG), { recursive: true, mode: 0o700 });
    fs.appendFileSync(
        KMS_RELEASE_LOG,
        JSON.stringify({ ts: new Date().toISOString(), ...entry }) + "\n",
        { encoding: "utf8", mode: 0o600 }
    );
}

function logDenied(keyRef, context, reason) {
    try {
        appendReleaseLog({
            event:      "KEY_RELEASE_DENIED",
            keyRef:     keyRef ?? null,
            actorID:    context?.actorID ?? null,
            actorRole:  context?.actorRole ?? null,
            resourceID: context?.resourceID ?? null,
            reason,
        });
    } catch (err) {
        console.error("[KMS] Failed to write release log (denial):", err.message);
    }
}

function hasFields(context, fields) {
    return fields.every((f) => typeof context?.[f] === "string" && context[f].trim() !== "");
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Encrypt a document buffer using AES-256-GCM under a fresh per-document DEK.
 * The wrapped DEK is persisted before the keyRef is returned.
 *
 * @param {Buffer} fileBuffer - Raw document bytes
 * @returns {{ encryptedBuffer: Buffer, keyRef: string }}
 */
export async function encryptDocument(fileBuffer) {
    if (!fileBuffer || fileBuffer.byteLength === 0) {
        throw new Error("Cannot encrypt empty buffer");
    }

    const store = getStore();
    const kek   = getKek();

    const dek = crypto.randomBytes(32);
    const iv  = crypto.randomBytes(12);

    const cipher    = crypto.createCipheriv("aes-256-gcm", dek, iv);
    const encrypted = Buffer.concat([cipher.update(fileBuffer), cipher.final()]);
    const authTag   = cipher.getAuthTag();

    const keyRef = generateKeyRef();

    store.set(keyRef, {
        keyID:     keyRef,
        algorithm: ALGORITHM,
        status:    "ACTIVE",
        createdAt: new Date().toISOString(),
        wrapped:   wrapDek(dek, kek, keyRef),
    });
    dek.fill(0);

    try {
        writeStoreFile(store);
    } catch (err) {
        store.delete(keyRef);
        console.error("[KMS] Failed to save key store:", err);
        throw new Error("[KMS] Key store write failed — document not encrypted");
    }

    // Layout: [ IV (12) | authTag (16) | ciphertext ]
    const encryptedBuffer = Buffer.concat([iv, authTag, encrypted]);

    console.log(`[KMS] Key generated and saved: ${keyRef}`);

    return { encryptedBuffer, keyRef };
}

/**
 * Decrypt a document buffer. The caller must identify itself; every release
 * (and every refused release) is written to the local release log, and the
 * plaintext is only returned once the release entry has been written.
 *
 * @param {Buffer} encryptedBuffer - [ IV | authTag | ciphertext ]
 * @param {string} keyRef          - e.g. "KEY0001"
 * @param {{ actorID: string, actorRole: string, resourceID: string }} context
 * @returns {Buffer} Original plaintext document
 */
export async function decryptDocument(encryptedBuffer, keyRef, context) {
    if (!hasFields(context, ["actorID", "actorRole", "resourceID"])) {
        logDenied(keyRef, context, "NO_CONTEXT");
        throw new Error("[KMS] Caller context required: actorID, actorRole and resourceID");
    }

    const record = getStore().get(keyRef);

    if (!record) {
        logDenied(keyRef, context, "KEY_NOT_FOUND");
        throw new Error(`[KMS] Key not found: ${keyRef}`);
    }

    if (record.status !== "ACTIVE") {
        logDenied(keyRef, context, record.status);
        throw new Error(`[KMS] Key ${keyRef} is not active (${record.status})`);
    }

    let plaintext;
    try {
        const dek = unwrapDek(record.wrapped, getKek(), keyRef);
        try {
            const iv         = encryptedBuffer.subarray(0, 12);
            const authTag    = encryptedBuffer.subarray(12, 28);
            const ciphertext = encryptedBuffer.subarray(28);

            const decipher = crypto.createDecipheriv("aes-256-gcm", dek, iv);
            decipher.setAuthTag(authTag);
            plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
        } finally {
            dek.fill(0);
        }
    } catch (err) {
        logDenied(keyRef, context, "DECRYPT_FAILED");
        throw err;
    }

    try {
        appendReleaseLog({
            event:      "KEY_RELEASE",
            keyRef,
            actorID:    context.actorID,
            actorRole:  context.actorRole,
            resourceID: context.resourceID,
        });
    } catch (err) {
        console.error("[KMS] Failed to write release log:", err.message);
        throw new Error("[KMS] Release log write failed — key not released");
    }

    return plaintext;
}

/**
 * Retrieve key metadata (never exposes key material).
 */
export async function getKey(keyRef) {
    const record = getStore().get(keyRef);

    if (!record) {
        throw new Error(`[KMS] Key not found: ${keyRef}`);
    }

    const meta = {
        keyID:     record.keyID,
        algorithm: record.algorithm,
        status:    record.status,
        createdAt: record.createdAt,
    };
    if (record.revokedAt)   meta.revokedAt   = record.revokedAt;
    if (record.destroyedAt) meta.destroyedAt = record.destroyedAt;
    return meta;
}

async function auditKeyEvent(action, keyRef, context) {
    try {
        const { logAudit } = await import("./auditMiddleware.js");
        // logAudit never throws; it returns null when the ledger write failed.
        const auditID = await logAudit({
            actorID:      context.actorID,
            actorRole:    context.actorRole,
            action,
            resourceType: "KMS_KEY",
            resourceID:   keyRef,
            actorOrg:     context.actorOrg ?? "",
        });
        return auditID ?? null;
    } catch (err) {
        console.error(`[KMS] Failed to audit ${action}:`, err.message);
        return null;
    }
}

/**
 * Local record of a key lifecycle event, kept next to the release log so a
 * revoke or destroy always leaves a trail even when the ledger audit failed.
 * auditPending is true when no on-chain audit ID could be obtained.
 * Best-effort: a failure here is logged and never changes the outcome.
 */
function recordKeyEvent(event, keyRef, context, auditID) {
    try {
        appendReleaseLog({
            event,
            keyRef,
            actorID:      context.actorID,
            actorRole:    context.actorRole,
            auditID:      auditID ?? null,
            auditPending: !auditID,
        });
    } catch (err) {
        console.error(`[KMS] Failed to write release log (${event}):`, err.message);
    }
}

/** Validate a lifecycle change without applying it. Returns the current record. */
function checkTransition(keyRef, context, allowedFrom) {
    if (!hasFields(context, ["actorID", "actorRole"])) {
        throw new Error("[KMS] Caller context required: actorID and actorRole");
    }

    const record = getStore().get(keyRef);

    if (!record) {
        throw new Error(`[KMS] Key not found: ${keyRef}`);
    }
    if (!allowedFrom.includes(record.status)) {
        throw new Error(`[KMS] Key ${keyRef} cannot move from ${record.status}`);
    }
    return record;
}

/**
 * Apply a lifecycle change and persist it atomically. The status is checked
 * again against the current record, so a change made while an audit call was
 * in flight is not overwritten.
 */
function applyTransition(keyRef, allowedFrom, apply) {
    const store  = getStore();
    const record = store.get(keyRef);

    if (!record) {
        throw new Error(`[KMS] Key not found: ${keyRef}`);
    }
    if (!allowedFrom.includes(record.status)) {
        throw new Error(`[KMS] Key ${keyRef} cannot move from ${record.status}`);
    }

    const next = apply({ ...record });
    store.set(keyRef, next);

    try {
        writeStoreFile(store);
    } catch (err) {
        store.set(keyRef, record);
        console.error("[KMS] Failed to save key store:", err);
        throw new Error("[KMS] Key store write failed — key state unchanged");
    }
    return next;
}

/**
 * Block further decryption with a key. Reversible only by editing the store.
 *
 * Revocation must stay available during an incident, so it does not depend on
 * the ledger: the state change is applied first, then the ledger audit is
 * attempted. If the audit fails, auditID is null and the event is still
 * written to the local log with auditPending: true.
 */
export async function revokeKey(keyRef, context) {
    checkTransition(keyRef, context, ["ACTIVE"]);
    const next = applyTransition(keyRef, ["ACTIVE"], (r) => ({
        ...r,
        status:    "REVOKED",
        revokedAt: new Date().toISOString(),
    }));
    const auditID = await auditKeyEvent("KEY_REVOKE", keyRef, context);
    recordKeyEvent("KEY_REVOKE", keyRef, context, auditID);
    return { keyID: keyRef, status: next.status, auditID };
}

/**
 * Crypto-shred a key: the wrapped DEK is removed from the store. Documents
 * encrypted under it become permanently unreadable. Copies of an older store
 * file (backups) still hold the wrapped DEK until they are purged or the KEK
 * they were wrapped under is retired.
 *
 * Destroying is irreversible, so it fails closed: the ledger audit is written
 * first, and if it cannot be written the key is left untouched. If the audit
 * succeeds but the store write then fails, the ledger holds a KEY_DESTROY
 * entry for a key that still exists; that case is recorded locally as
 * KEY_DESTROY_FAILED with the audit ID so the two can be reconciled.
 */
export async function destroyKey(keyRef, context) {
    checkTransition(keyRef, context, ["ACTIVE", "REVOKED"]);

    const auditID = await auditKeyEvent("KEY_DESTROY", keyRef, context);
    if (!auditID) {
        recordKeyEvent("KEY_DESTROY_REFUSED", keyRef, context, null);
        throw new Error("[KMS] Audit write failed — key not destroyed");
    }

    let next;
    try {
        next = applyTransition(keyRef, ["ACTIVE", "REVOKED"], (r) => {
            const { wrapped, ...rest } = r;
            return { ...rest, status: "DESTROYED", destroyedAt: new Date().toISOString() };
        });
    } catch (err) {
        recordKeyEvent("KEY_DESTROY_FAILED", keyRef, context, auditID);
        throw err;
    }

    recordKeyEvent("KEY_DESTROY", keyRef, context, auditID);
    return { keyID: keyRef, status: next.status, auditID };
}

// ── Offline maintenance (used by backend/scripts) ────────────────────────────

/**
 * Re-wrap every stored DEK under a new KEK. All keys are unwrapped and
 * re-wrapped in memory first; the store is replaced atomically only if every
 * key succeeded. keyRef values are unchanged. Run with the backend stopped,
 * then switch KMS_KEK / KMS_KEK_FILE to the new KEK and restart.
 *
 * @returns {number} number of keys re-wrapped
 */
export function rewrapAllKeys(oldKek, newKek) {
    const store = readStoreFile();
    const next  = new Map();
    let count   = 0;

    for (const [keyRef, record] of store.entries()) {
        if (record.status === "DESTROYED") {
            next.set(keyRef, record);
            continue;
        }
        const dek = unwrapDek(record.wrapped, oldKek, keyRef);
        const rewrapped = wrapDek(dek, newKek, keyRef);
        if (!unwrapDek(rewrapped, newKek, keyRef).equals(dek)) {
            throw new Error(`[KMS] Re-wrap verification failed for ${keyRef}`);
        }
        dek.fill(0);
        next.set(keyRef, { ...record, wrapped: rewrapped });
        count++;
    }

    writeStoreFile(next);
    keyStore   = null;
    cachedKek  = newKek;
    return count;
}

/**
 * One-time conversion of the legacy plaintext store (records holding a raw
 * hex "key") into the wrapped format. keyRef values are preserved. Every
 * wrapped key is verified before the store is replaced; by default the
 * legacy file is kept next to it as a 0600 backup that must be deleted
 * securely once the migration is confirmed.
 *
 * @returns {{ migrated: number, backupPath: string | null }}
 */
export function migrateLegacyStore(kek, { backup = true } = {}) {
    if (!fs.existsSync(KMS_STORE_PATH)) {
        throw new Error("[KMS] No key store to migrate");
    }

    const raw    = fs.readFileSync(KMS_STORE_PATH, "utf8");
    const parsed = JSON.parse(raw);

    if (parsed.version === STORE_VERSION) {
        throw new Error("[KMS] Key store is already in the wrapped format");
    }

    const keys = {};
    for (const [keyRef, record] of Object.entries(parsed)) {
        if (typeof record?.key !== "string" || !/^[0-9a-fA-F]{64}$/.test(record.key)) {
            throw new Error(`[KMS] Legacy record ${keyRef} has no valid key`);
        }
        const status = record.status ?? "ACTIVE";
        if (!STATUSES.has(status) || status === "DESTROYED") {
            throw new Error(`[KMS] Legacy record ${keyRef} has unsupported status ${status}`);
        }

        const dek     = Buffer.from(record.key, "hex");
        const wrapped = wrapDek(dek, kek, keyRef);
        if (!unwrapDek(wrapped, kek, keyRef).equals(dek)) {
            throw new Error(`[KMS] Wrap verification failed for ${keyRef}`);
        }
        dek.fill(0);

        keys[keyRef] = {
            keyID:     keyRef,
            algorithm: record.algorithm ?? ALGORITHM,
            status,
            createdAt: record.createdAt,
            wrapped,
        };
    }

    let backupPath = null;
    if (backup) {
        backupPath = `${KMS_STORE_PATH}.legacy-${new Date().toISOString().replace(/[:.]/g, "-")}`;
        writeFileAtomic(backupPath, raw);
    }

    writeFileAtomic(KMS_STORE_PATH, JSON.stringify({ version: STORE_VERSION, keys }, null, 2));
    keyStore = null;

    return { migrated: Object.keys(keys).length, backupPath };
}
