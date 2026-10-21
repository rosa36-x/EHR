import fs from 'fs';
import path from 'path';
import { MongoClient } from 'mongodb';

// Matches kmsService.js: resolved relative to CWD, not __dirname.
// Run this script from backend/ (same cwd you launch server.js from).
const KMS_STORE_PATH = path.resolve('./data/kms_store.json');
const KMS_RELEASE_LOG_PATH = path.resolve('./data/kms_release_log.jsonl');
const MONGO_URI = 'mongodb://localhost:27017/medvault';
const DB_NAME = 'medvault';

async function resetTestDb() {
  // Reset KMS store
  fs.mkdirSync(path.dirname(KMS_STORE_PATH), { recursive: true });
  fs.writeFileSync(KMS_STORE_PATH, JSON.stringify({ version: 2, keys: {} }), { mode: 0o600 });
  fs.rmSync(KMS_RELEASE_LOG_PATH, { force: true });
  console.log('[reset-test-db] Reset KMS store at', KMS_STORE_PATH);

  // Reset Mongo database
  const client = new MongoClient(MONGO_URI);
  await client.connect();
  const db = client.db(DB_NAME);
  await db.dropDatabase();
  console.log('[reset-test-db] Dropped', DB_NAME, 'database');
  await client.close();
}

resetTestDb()
  .then(() => {
    console.log('[reset-test-db] Done.');
    process.exit(0);
  })
  .catch((err) => {
    console.error('[reset-test-db] Failed:', err);
    process.exit(1);
  });