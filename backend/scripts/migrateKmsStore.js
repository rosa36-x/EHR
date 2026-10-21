import { loadKek, migrateLegacyStore } from "../services/kmsService.js";

// Run from backend/ with KMS_KEK or KMS_KEK_FILE set.
// Pass --no-backup to skip keeping the legacy plaintext file.
const backup = !process.argv.includes("--no-backup");

try {
    const { migrated, backupPath } = migrateLegacyStore(loadKek(), { backup });
    console.log(`[migrate-kms] Wrapped ${migrated} key(s) under the configured KEK.`);
    if (backupPath) {
        console.log(`[migrate-kms] Legacy plaintext copy kept at ${backupPath}`);
        console.log("[migrate-kms] Verify the backend works, then delete that file securely.");
    }
    process.exit(0);
} catch (err) {
    console.error("[migrate-kms] Failed:", err.message);
    process.exit(1);
}
