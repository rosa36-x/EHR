/**
 * unit/authMiddleware.test.js
 *
 * Tests the REAL authMiddleware functions:
 *   - authenticateToken  — verifies the JWT and populates req.user
 *   - authorizeRoles     — enforces role-based access control
 *
 * Uses in-process Express stubs; no Fabric/IPFS/MongoDB needed.
 */

'use strict';

const express    = require('express');
const supertest  = require('supertest');
const { makeToken, expiredToken } = require('../helpers');

// Load the REAL middleware (no mock)
const { authenticateToken, authorizeRoles } =
  jest.requireActual('../../../backend/services/authMiddleware');

// ── minimal test app ───────────────────────────────────────────────────────────
function makeApp(roles = []) {
  const app = express();
  app.use(express.json());

  const guards = [authenticateToken];
  if (roles.length) guards.push(authorizeRoles(...roles));

  app.get('/protected', ...guards, (req, res) =>
    res.json({ status: 'SUCCESS', user: req.user })
  );
  return app;
}

// ── authenticateToken ─────────────────────────────────────────────────────────
describe('authenticateToken', () => {
  test('valid doctor token → 200, req.user populated', async () => {
    const token = makeToken('doctor', 'DOC0001');
    const res   = await supertest(makeApp())
      .get('/protected')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.user.id).toBe('DOC0001');
    expect(res.body.user.role).toBe('doctor');
  });

  test('valid patient token → 200, req.user populated', async () => {
    const token = makeToken('patient', 'PAT0001');
    const res   = await supertest(makeApp())
      .get('/protected')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.user.id).toBe('PAT0001');
    expect(res.body.user.role).toBe('patient');
  });

  test('no token → 401', async () => {
    const res = await supertest(makeApp()).get('/protected');
    expect(res.status).toBe(401);
    expect(res.body.status).toBe('FAILED');
  });

  test('expired token → 401', async () => {
    const token = expiredToken('doctor', 'DOC0001');
    const res   = await supertest(makeApp())
      .get('/protected')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(401);
    expect(res.body.status).toBe('FAILED');
    expect(res.body.message).toMatch(/expired|invalid/i);
  });

  test('tampered signature → 401', async () => {
    const token = makeToken('doctor', 'DOC0001');
    const tampered = token.slice(0, -5) + 'XXXXX';
    const res = await supertest(makeApp())
      .get('/protected')
      .set('Authorization', `Bearer ${tampered}`);

    expect(res.status).toBe(401);
    expect(res.body.status).toBe('FAILED');
  });

  test('malformed Bearer value → 401', async () => {
    const res = await supertest(makeApp())
      .get('/protected')
      .set('Authorization', 'NotBearer notavalidtoken');

    expect(res.status).toBe(401);
  });
});

// ── authorizeRoles ─────────────────────────────────────────────────────────────
describe('authorizeRoles', () => {
  test('doctor token on doctor-only route → 200', async () => {
    const token = makeToken('doctor', 'DOC0001');
    const res   = await supertest(makeApp(['doctor']))
      .get('/protected')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
  });

  test('patient token on doctor-only route → 403', async () => {
    const token = makeToken('patient', 'PAT0001');
    const res   = await supertest(makeApp(['doctor']))
      .get('/protected')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
    expect(res.body.status).toBe('FAILED');
  });

  test('doctor token on patient-only route → 403', async () => {
    const token = makeToken('doctor', 'DOC0001');
    const res   = await supertest(makeApp(['patient']))
      .get('/protected')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
    expect(res.body.status).toBe('FAILED');
  });

  test('multi-role route accepts both doctor and patient', async () => {
    const doctorToken  = makeToken('doctor',  'DOC0001');
    const patientToken = makeToken('patient', 'PAT0001');
    const app = makeApp(['doctor', 'patient']);

    const r1 = await supertest(app).get('/protected').set('Authorization', `Bearer ${doctorToken}`);
    const r2 = await supertest(app).get('/protected').set('Authorization', `Bearer ${patientToken}`);

    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
  });

  test('403 response includes message naming required role', async () => {
    const token = makeToken('patient', 'PAT0001');
    const res   = await supertest(makeApp(['doctor']))
      .get('/protected')
      .set('Authorization', `Bearer ${token}`);

    expect(res.body.message).toMatch(/doctor/i);
  });
});
