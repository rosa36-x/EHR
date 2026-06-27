import crypto from "crypto";
import fs from "fs";
import path from "path";

/**
 * Persistent KMS store backed by a JSON file on disk.
 *
 * File location: backend/data/kms_store.json
 * Keys are stored as hex strings (never raw bytes in memory across restarts).
 *
 * Structure on disk:
 * {
 *   "KEY0001": {
 *     "keyID": "KEY0001",
 *     "key": "<hex>",
 *     "algorithm": "AES-256-GCM",
 *     "status": "ACTIVE",
 *     "createdAt": "<iso>"
 *   },
 *   ...
 * }
 */
const KMS_STORE_PATH = path.resolve("./data/kms_store.json");

/**
 * Load key store from disk into memory on startup.
 * Returns a Map with key Buffers restored from hex.
 */
function loadKeyStore() {
    try {
        if (!fs.existsSync(KMS_STORE_PATH)) {
            console.log("[KMS] No existing key store found, starting fresh.");
            return new Map();
        }

        const raw     = fs.readFileSync(KMS_STORE_PATH, "utf8");
        const parsed  = JSON.parse(raw);
        const store   = new Map();

        for (const [keyRef, record] of Object.entries(parsed)) {
            store.set(keyRef, {
                ...record,
                // Restore hex strings back to Buffers
                key: Buffer.from(record.key, "hex"),
            });
        }

        console.log(`[KMS] Loaded ${store.size} key(s) from disk.`);
        return store;
    } catch (err) {
        console.error("[KMS] Failed to load key store:", err);
        return new Map();
    }
}

/**
 * Persist the full key store to disk after every write.
 * Keys are serialized as hex strings.
 */
function saveKeyStore() {
    try {
        const obj = {};

        for (const [keyRef, record] of keyStore.entries()) {
            obj[keyRef] = {
                ...record,
                // Convert Buffer → hex for JSON serialization
                key: record.key.toString("hex"),
            };
        }

        fs.mkdirSync(path.dirname(KMS_STORE_PATH), { recursive: true });
        fs.writeFileSync(KMS_STORE_PATH, JSON.stringify(obj, null, 2), "utf8");
    } catch (err) {
        console.error("[KMS] Failed to save key store:", err);
        throw new Error("[KMS] Key store write failed — document not encrypted");
    }
}

/**
 * Derive the next keyCounter from the existing store so we never
 * reuse a KEY reference across restarts.
 */
function deriveCounter(store) {
    let max = 0;
    for (const keyRef of store.keys()) {
        const n = parseInt(keyRef.replace("KEY", ""), 10);
        if (!isNaN(n) && n > max) max = n;
    }
    return max + 1;
}

// ── Initialize on module load ─────────────────────────────────────────────────
const keyStore   = loadKeyStore();
let keyCounter   = deriveCounter(keyStore);

/**
 * Generate a unique key reference string.
 * Format: KEY0001, KEY0002, ...
 */
function generateKeyRef() {
    const ref = `KEY${String(keyCounter).padStart(4, "0")}`;
    keyCounter++;
    return ref;
}

/**
 * Encrypt a document buffer using AES-256-GCM.
 * Generates a unique key per document and persists it to disk immediately.
 *
 * @param {Buffer} fileBuffer - Raw document bytes
 * @returns {{ encryptedBuffer: Buffer, keyRef: string }}
 */
export async function encryptDocument(fileBuffer) {
    if (!fileBuffer || fileBuffer.byteLength === 0) {
        throw new Error("Cannot encrypt empty buffer");
    }

    const key = crypto.randomBytes(32); // 256-bit AES key
    const iv  = crypto.randomBytes(12); // 96-bit IV for GCM

    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);

    const encrypted = Buffer.concat([
        cipher.update(fileBuffer),
        cipher.final(),
    ]);

    const authTag = cipher.getAuthTag(); // 16-byte GCM auth tag

    const keyRef    = generateKeyRef();
    const createdAt = new Date().toISOString();

    // Write to in-memory store first
    keyStore.set(keyRef, {
        keyID:     keyRef,
        key,
        algorithm: "AES-256-GCM",
        status:    "ACTIVE",
        createdAt,
    });

    // Immediately persist to disk — if this fails, we throw before returning
    // the keyRef so the caller never gets a ref to a key that wasn't saved
    saveKeyStore();

    // Layout: [ IV (12) | authTag (16) | ciphertext ]
    const encryptedBuffer = Buffer.concat([iv, authTag, encrypted]);

    console.log(`[KMS] Key generated and saved: ${keyRef}`);

    return { encryptedBuffer, keyRef };
}

/**
 * Decrypt a document buffer using AES-256-GCM.
 *
 * @param {Buffer} encryptedBuffer - Buffer with [ IV | authTag | ciphertext ]
 * @param {string} keyRef - Key reference string (e.g. "KEY0001")
 * @returns {Buffer} - Original plaintext document
 */
export async function decryptDocument(encryptedBuffer, keyRef) {
    const record = keyStore.get(keyRef);

    if (!record) {
        throw new Error(`[KMS] Key not found: ${keyRef}`);
    }

    if (record.status !== "ACTIVE") {
        throw new Error(`[KMS] Key ${keyRef} is not active`);
    }

    // Unpack: IV (12 bytes) | authTag (16 bytes) | ciphertext
    const iv         = encryptedBuffer.subarray(0, 12);
    const authTag    = encryptedBuffer.subarray(12, 28);
    const ciphertext = encryptedBuffer.subarray(28);

    const decipher = crypto.createDecipheriv("aes-256-gcm", record.key, iv);
    decipher.setAuthTag(authTag);

    const decrypted = Buffer.concat([
        decipher.update(ciphertext),
        decipher.final(),
    ]);

    return decrypted;
}

/**
 * Retrieve key metadata (never exposes raw key bytes).
 *
 * @param {string} keyRef
 * @returns {{ keyID: string, algorithm: string, status: string, createdAt: string }}
 */
export async function getKey(keyRef) {
    const record = keyStore.get(keyRef);

    if (!record) {
        throw new Error(`[KMS] Key not found: ${keyRef}`);
    }

    return {
        keyID:     record.keyID,
        algorithm: record.algorithm,
        status:    record.status,
        createdAt: record.createdAt,
    };
}
