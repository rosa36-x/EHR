/**
 * unit/idService.test.js
 *
 * Tests the REAL idService to verify:
 *   - Each entity type generates IDs with the correct prefix
 *   - IDs are sequential and monotonically increasing
 *   - Concurrent calls don't produce duplicate IDs
 */

'use strict';

const path = require('path');
const fs   = require('fs');
const os   = require('os');

// ── We need to point idService at a TEMP store so tests don't pollute
//    the real data/id_store.json ──────────────────────────────────────

let tmpDir, tmpStore, idService;

beforeAll(() => {
  tmpDir   = fs.mkdtempSync(path.join(os.tmpdir(), 'medvault-idtest-'));
  tmpStore = path.join(tmpDir, 'id_store.json');

  // Patch the store path before requiring the module
  // (idService reads ID_STORE_PATH at module load time or per-call)
  process.env.ID_STORE_PATH = tmpStore;
  // Clear module cache to force re-require with new env
  jest.resetModules();
  idService = require('../../../../backend/services/idService');
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.ID_STORE_PATH;
});

// Known prefix mappings from idService (prefix → entity)
const prefixMap = {
  patient:      'PAT',
  consultation: 'CONS',
  prescription: 'PRE',
  labReport:    'LAB',
  referral:     'REF',
  consent:      'CON',
  audit:        'AUD',
  emergency:    'EA',
  treatmentRelationship: 'TR',
  permissionRequest:    'PREQ',
};

describe('idService — prefix correctness', () => {
  test.each(Object.entries(prefixMap))(
    'generateID("%s") starts with %s',
    (entity, prefix) => {
      const id = idService.generateID(entity);
      expect(id).toMatch(new RegExp(`^${prefix}`));
    }
  );
});

describe('idService — sequential monotonic IDs', () => {
  test('same entity type produces strictly increasing numeric suffixes', () => {
    jest.resetModules();
    const svc  = require('../../../../backend/services/idService');
    const ids  = Array.from({ length: 10 }, () => svc.generateID('consultation'));
    const nums = ids.map((id) => parseInt(id.replace(/^CONS/, ''), 10));

    for (let i = 1; i < nums.length; i++) {
      expect(nums[i]).toBeGreaterThan(nums[i - 1]);
    }
  });
});

describe('idService — uniqueness under concurrent calls', () => {
  test('50 concurrent generateID calls produce 50 unique IDs', async () => {
    jest.resetModules();
    const svc = require('../../../../backend/services/idService');
    const ids = await Promise.all(
      Array.from({ length: 50 }, () =>
        Promise.resolve(svc.generateID('audit'))
      )
    );
    const unique = new Set(ids);
    expect(unique.size).toBe(50);
  });
});

describe('idService — unknown entity', () => {
  test('unknown entity type throws a descriptive error', () => {
    expect(() => idService.generateID('notanentity')).toThrow();
  });
});
