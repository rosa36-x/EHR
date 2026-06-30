/**
 * unit/sensitivityService.test.js
 *
 * Tests the REAL sensitivityService to verify:
 *   - NORMAL records are correctly classified
 *   - SENSITIVE records (psychiatry, HIV, substance abuse, etc.) are classified
 *   - isValidRecordType correctly validates category/recordType pairs
 *   - Unknown/lowercase record types fall back to NORMAL (documented behaviour)
 */

'use strict';

const { getSensitivityLevel, isSensitive, isValidRecordType, RecordTypes } =
  jest.requireActual('../../../../backend/services/sensitivityService');

describe('sensitivityService — getSensitivityLevel', () => {

  describe('NORMAL records', () => {
    const normalTypes = [
      'GENERAL',
      'FOLLOW_UP',
      'BLOOD_TEST',
      'URINE_TEST',
      'DERMATOLOGY',
      'BIOPSY',
      'IMAGING',
      'GENERAL_CHRONIC',
    ];

    test.each(normalTypes)('%s → NORMAL', (recordType) => {
      expect(getSensitivityLevel(recordType)).toBe('NORMAL');
    });
  });

  describe('SENSITIVE records', () => {
    const sensitiveTypes = [
      'PSYCHIATRY',
      'HIV_TEST',
      'SUBSTANCE_ABUSE',
      'REPRODUCTIVE_HEALTH',
      'GENETIC_TEST',
      'HIV_AIDS',
      'CONTROLLED_SUBSTANCE',
    ];

    test.each(sensitiveTypes)('%s → SENSITIVE', (recordType) => {
      expect(getSensitivityLevel(recordType)).toBe('SENSITIVE');
    });
  });

  describe('edge cases', () => {
    test('unknown recordType safely defaults to NORMAL (not in SENSITIVE_TYPES)', () => {
      // The service has no explicit allow-list check — anything not in
      // SENSITIVE_TYPES is treated as NORMAL by design.
      expect(getSensitivityLevel('MADE_UP_TYPE')).toBe('NORMAL');
      expect(isSensitive('MADE_UP_TYPE')).toBe(false);
    });

    test('recordType matching is case-sensitive — lowercase falls back to NORMAL', () => {
      // Documents that the Set lookup in isSensitive() is exact-match only.
      // "psychiatry" (lowercase) is NOT in SENSITIVE_TYPES, only "PSYCHIATRY" is.
      expect(getSensitivityLevel('psychiatry')).toBe('NORMAL');
      expect(isSensitive('psychiatry')).toBe(false);
    });
  });
});

describe('sensitivityService — isValidRecordType', () => {
  test('returns true for a real type within its real category', () => {
    expect(isValidRecordType('CONSULTATION', 'PSYCHIATRY')).toBe(true);
    expect(isValidRecordType('LAB_REPORT', 'BLOOD_TEST')).toBe(true);
  });

  test('returns false when the recordType belongs to a different category', () => {
    // PSYCHIATRY exists under CONSULTATION, not LAB_REPORT
    expect(isValidRecordType('LAB_REPORT', 'PSYCHIATRY')).toBe(false);
  });

  test('returns false for an unknown category', () => {
    expect(isValidRecordType('NOT_A_CATEGORY', 'GENERAL')).toBe(false);
  });

  test('returns false for an unknown recordType in a valid category', () => {
    expect(isValidRecordType('CONSULTATION', 'MADE_UP_TYPE')).toBe(false);
  });
});

describe('sensitivityService — RecordTypes taxonomy', () => {
  test('exposes the four expected categories', () => {
    expect(Object.keys(RecordTypes)).toEqual(
      expect.arrayContaining(['CONSULTATION', 'LAB_REPORT', 'PRESCRIPTION', 'REFERRAL'])
    );
  });
});
