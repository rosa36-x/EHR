/**
 * __mocks__/ipfsService.js
 *
 * Replaces Helia/IPFS for unit tests. Returns deterministic CIDs
 * so tests can assert on storage paths without a running IPFS daemon.
 */

'use strict';

let _cidCounter = 1;

const uploadToIPFS = jest.fn(async (buffer) => {
  if (!buffer || buffer.length === 0) {
    throw new Error('IPFS upload failed: empty buffer');
  }
  return `bafymock${String(_cidCounter++).padStart(8, '0')}`;
});

const downloadFromIPFS = jest.fn(async (cid) => {
  if (!cid || cid === 'notavalidcid12345') {
    throw new Error(`Invalid CID: ${cid}`);
  }
  return Buffer.from('%PDF-1.4 mock content');
});

const stopIPFS = jest.fn(async () => {});

const __resetAll = () => {
  uploadToIPFS.mockClear();
  downloadFromIPFS.mockClear();
  stopIPFS.mockClear();
  _cidCounter = 1;
};

module.exports = { uploadToIPFS, downloadFromIPFS, stopIPFS, __resetAll };
