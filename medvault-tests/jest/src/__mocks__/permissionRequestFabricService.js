/**
 * __mocks__/permissionRequestFabricService.js
 *
 * Domain-level mock matching the real permissionRequestFabricService.js
 * exports exactly: createPermissionRequest, approvePermissionRequest,
 * rejectPermissionRequest, getPermissionRequest, hasActivePermission.
 */

'use strict';

let _seq = 1;
const nextID = (prefix) => `${prefix}${String(_seq++).padStart(4, '0')}`;
const SUCCESS = (extra = {}) => ({ status: 'SUCCESS', ...extra });

const createPermissionRequest = jest.fn(async () => SUCCESS({
  requestID: nextID('PREQ'),
  expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
}));

const getPermissionRequest = jest.fn(async (requestID) => SUCCESS({
  data: { requestID, status: 'PENDING' },
}));

const approvePermissionRequest = jest.fn(async (requestID) => SUCCESS({
  requestID,
  accessExpires: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
}));

const rejectPermissionRequest = jest.fn(async (requestID) => SUCCESS({ requestID }));

const hasActivePermission = jest.fn(async () => false);

const __resetAll = () => {
  [createPermissionRequest, getPermissionRequest, approvePermissionRequest, rejectPermissionRequest, hasActivePermission]
    .forEach((fn) => fn.mockClear());
  _seq = 1;
};

module.exports = {
  createPermissionRequest,
  getPermissionRequest,
  approvePermissionRequest,
  rejectPermissionRequest,
  hasActivePermission,
  __resetAll,
};
