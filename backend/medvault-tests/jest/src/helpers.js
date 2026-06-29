/**
 * helpers.js
 *
 * Shared test utilities:
 *   - makeToken(role, id, opts) — sign a JWT with the dev secret
 *   - expiredToken(role, id)    — JWT with exp in the past
 *   - makeApp()                 — load the Express app with mocks already in place
 */

'use strict';

const jwt = require('jsonwebtoken');

// Must match JWT_SECRET in backend/.env or backend/services/authMiddleware.js
const JWT_SECRET = process.env.JWT_SECRET || 'medvault-dev-secret-change-in-prod';

/**
 * Sign a fresh JWT for the given role and id.
 * @param {'doctor'|'patient'} role
 * @param {string} id   — doctorID or patientID
 * @param {object} opts — override any claim, e.g. { expiresIn: '1s' }
 */
function makeToken(role, id, opts = {}) {
  const defaults = {
    expiresIn: role === 'doctor' ? '8h' : '24h',
  };
  return jwt.sign({ id, role }, JWT_SECRET, { ...defaults, ...opts });
}

/**
 * Returns an already-expired JWT (exp = 1 second in the past).
 */
function expiredToken(role = 'doctor', id = 'DOC0001') {
  return jwt.sign({ id, role, iat: 1 }, JWT_SECRET, { expiresIn: -1 });
}

/**
 * Convenience: auth header value ready to pass to supertest.
 *   .set(...authHeader('doctor', 'DOC0001'))
 */
function authHeader(role, id, opts) {
  return ['Authorization', `Bearer ${makeToken(role, id, opts)}`];
}

module.exports = { makeToken, expiredToken, authHeader, JWT_SECRET };
