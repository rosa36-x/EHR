const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');

module.exports = async () => {
  // Reset KMS store
  const kmsStorePath = path.resolve(__dirname, './data/kms_store.json');
  fs.mkdirSync(path.dirname(kmsStorePath), { recursive: true });
  fs.writeFileSync(kmsStorePath, JSON.stringify({ version: 2, keys: {} }));
  fs.rmSync(path.resolve(__dirname, './data/kms_release_log.jsonl'), { force: true });
  console.log('[globalSetup] Reset KMS store at', kmsStorePath);

  // Reset test database
  const client = new MongoClient('mongodb://localhost:27017/medvault');
  await client.connect();
  const db = client.db('medvault');
  await db.dropDatabase();
  console.log('[globalSetup] Dropped medvault test database');
  await client.close();
};