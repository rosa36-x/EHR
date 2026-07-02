/**
 * __mocks__/ipfsService.js
 *
 * Matches the real ipfsService.js API exactly:
 *   uploadFile(fileBuffer) -> cid string
 *   getFile(cid, options?) -> Buffer
 *   initIPFS(), stopIPFS(), registerShutdownHandlers() -> no-ops
 *
 * Deterministic in-memory round-trip so getFile can recover whatever
 * uploadFile produced within the same test run.
 */

'use strict';

let _cidCounter = 1;
const _store = new Map(); // cid -> Buffer

const uploadFile = jest.fn(async (fileBuffer) => {
  if (!fileBuffer || fileBuffer.byteLength === 0) {
    throw new Error('Cannot upload empty buffer');
  }
  const cid = `bafymock${String(_cidCounter++).padStart(8, '0')}`;
  _store.set(cid, fileBuffer);
  return cid;
});

const getFile = jest.fn(async (cid) => {
  if (_store.has(cid)) {
    return _store.get(cid);
  }
  throw new Error(`Invalid CID: "${cid}"`);
});

const initIPFS = jest.fn(async () => ({ helia: {}, ipfsFs: {} }));
const stopIPFS = jest.fn(async () => {});
const registerShutdownHandlers = jest.fn(() => {});

const __resetAll = () => {
  uploadFile.mockClear();
  getFile.mockClear();
  initIPFS.mockClear();
  stopIPFS.mockClear();
  registerShutdownHandlers.mockClear();
  _store.clear();
  _cidCounter = 1;
};

module.exports = { uploadFile, getFile, initIPFS, stopIPFS, registerShutdownHandlers, __resetAll };
