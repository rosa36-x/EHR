import fs from "fs";
import path from "path";

/**
 * Persistent sequential ID generator.
 * Counters stored in backend/data/id_store.json
 * Survives server restarts — never reuses an ID.
 *
 * Format: <PREFIX><4-digit-number>
 * e.g. PAT0001, PRE0002, LAB0003
 *
 * Concurrency note: loadStore/saveStore use synchronous fs calls and
 * generateID() is not async, so within a single Node process the event
 * loop cannot interleave two calls — no read-modify-write race here.
 * This is NOT safe across multiple processes/instances sharing the same
 * id_store.json (e.g. a future PM2 cluster or multi-instance deployment)
 * — that would need a real file lock or move the counter into MongoDB.
 */

const ID_STORE_PATH = path.resolve("./data/id_store.json");

const PREFIXES = {
    patient:             "PAT",
    consultation:        "CONS",
    prescription:        "PRE",
    labReport:           "LAB",
    referral:            "REF",
    consent:             "CON",
    audit:               "AUD",
    emergency:           "EA",
    permissionRequest:   "PREQ",
    treatmentRelationship: "TR",
    doctor:              "DOC",
    orgActor:            "ORG",
    anomalyFlag:         "ANOM",
    appointment:         "APT",
};

/**
 * Load counter store from disk.
 * Initializes all counters to 1 if file doesn't exist.
 */
function loadStore() {
    try {
        if (!fs.existsSync(ID_STORE_PATH)) {
            const initial = {};
            for (const key of Object.keys(PREFIXES)) {
                initial[key] = 1;
            }
            fs.mkdirSync(path.dirname(ID_STORE_PATH), { recursive: true });
            fs.writeFileSync(ID_STORE_PATH, JSON.stringify(initial, null, 2), "utf8");
            return initial;
        }

        const store = JSON.parse(fs.readFileSync(ID_STORE_PATH, "utf8"));

        // Backfill: PREFIXES can grow over time (new asset types added
        // after this file already existed on disk). Without this, a
        // missing key reads as `undefined`, and undefined++ -> NaN ->
        // JSON.stringify silently turns that into `null` on save, which
        // then reads back as the literal string "null" in the next ID
        // (see anomalyFlag/"ANOMnull" incident). Backfill instead of
        // letting that arithmetic happen at all.
        let changed = false;
        for (const key of Object.keys(PREFIXES)) {
            if (typeof store[key] !== "number" || !Number.isFinite(store[key])) {
                store[key] = 1;
                changed = true;
            }
        }
        if (changed) saveStore(store);

        return store;
    } catch (err) {
        console.error("[IDService] Failed to load ID store:", err);
        throw err;
    }
}

/**
 * Save counter store to disk.
 */
function saveStore(store) {
    try {
        fs.writeFileSync(ID_STORE_PATH, JSON.stringify(store, null, 2), "utf8");
    } catch (err) {
        console.error("[IDService] Failed to save ID store:", err);
        throw new Error("[IDService] ID store write failed");
    }
}

/**
 * Generate a unique sequential ID for a given asset type.
 *
 * @param {string} type - One of the keys in PREFIXES
 * @returns {string} e.g. "PAT0001"
 */
export function generateID(type) {
    if (!PREFIXES[type]) {
        throw new Error(`[IDService] Unknown asset type: "${type}". Valid types: ${Object.keys(PREFIXES).join(", ")}`);
    }

    const store  = loadStore();
    const prefix = PREFIXES[type];
    const id     = `${prefix}${String(store[type]).padStart(4, "0")}`;

    store[type]++;
    saveStore(store);

    return id;
}
