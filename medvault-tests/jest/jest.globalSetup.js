const fs = require('fs');
const path = require('path');

module.exports = async () => {
  const kmsStorePath = path.resolve(__dirname, './data/kms_store.json');
  fs.writeFileSync(kmsStorePath, JSON.stringify({}));
  console.log('[globalSetup] Reset KMS store at', kmsStorePath);
};