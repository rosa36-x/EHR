import fs from "fs";
import { loadKek, parseKek, rewrapAllKeys } from "../services/kmsService.js";

// Run from backend/ with the backend stopped.
// Current KEK: KMS_KEK_FILE or KMS_KEK (as the backend uses it).
// New KEK:     KMS_KEK_NEW_FILE or KMS_KEK_NEW.
// Afterwards, point KMS_KEK_FILE / KMS_KEK at the new KEK and restart.
function loadNewKek() {
    if (process.env.KMS_KEK_NEW_FILE) {
        return parseKek(fs.readFileSync(process.env.KMS_KEK_NEW_FILE, "utf8"));
    }
    if (process.env.KMS_KEK_NEW) {
        return parseKek(process.env.KMS_KEK_NEW);
    }
    throw new Error("Set KMS_KEK_NEW_FILE or KMS_KEK_NEW");
}

try {
    const count = rewrapAllKeys(loadKek(), loadNewKek());
    console.log(`[rotate-kms-kek] Re-wrapped ${count} key(s) under the new KEK.`);
    process.exit(0);
} catch (err) {
    console.error("[rotate-kms-kek] Failed:", err.message);
    process.exit(1);
}
