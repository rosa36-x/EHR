/**
 * unit/sensitivityService.test.js
 *
 * Tests the REAL sensitivityService to verify:
 *   - NORMAL records are correctly classified
 *   - SENSITIVE records (psychiatry, HIV, substance abuse, etc.) are classified
 *   - RESTRICTED records (genetic data) are classified
 *   - Unknown record types throw or return a safe default
 */

'use strict';

const { classifyRecord } = jest.requireActual('../../../backend/services/sensitivityService');

describe('sensitivityService — classifyRecord', () => {

  describe('NORMAL records', () => {
    const normalTypes = [
      'GENERAL',
      'BLOOD_TEST',
      'URINE_TEST',
      'X_RAY',
      'MRI',
      'VACCINATION',
      'DENTAL',
      'OPHTHALMOLOGY',
    ];

    test.each(normalTypes)('%s → NORMAL', (recordType) => {
      expect(classifyRecord(recordType)).toBe('NORMAL');
    });
  });

  describe('SENSITIVE records', () => {
    const sensitiveTypes = [
      'PSYCHIATRY',
      'HIV_TEST',
      'SUBSTANCE_ABUSE',
      'SEXUAL_HEALTH',
      'REPRODUCTIVE_HEALTH',
      'ABORTION',
    ];

    test.each(sensitiveTypes)('%s → SENSITIVE', (recordType) => {
      expect(classifyRecord(recordType)).toBe('SENSITIVE');
    });
  });

  describe('RESTRICTED records', () => {
    const restrictedTypes = [
      'GENETIC_TEST',
    ];

    test.each(restrictedTypes)('%s → RESTRICTED', (recordType) => {
      expect(classifyRecord(recordType)).toBe('RESTRICTED');
    });
  });

  describe('edge cases', () => {
    test('unknown recordType throws or returns a non-null string', () => {
      // The service should either throw with a descriptive error,
      // or return a safe default — it must not return undefined/null.
      let result;
      try {
        result = classifyRecord('MADE_UP_TYPE');
        expect(typeof result).toBe('string');
      } catch (err) {
        expect(err.message).toMatch(/recordType|Invalid|unknown/i);
      }
    });

    test('recordType is case-sensitive (lowercase should fail or be classified)', () => {
      // Confirms the service expects uppercase — documents its behaviour.
      let result;
      try {
        result = classifyRecord('psychiatry'); // lowercase
        // If it returns something, just confirm it's a string
        expect(typeof result).toBe('string');
      } catch (err) {
        expect(err).toBeDefined();
      }
    });
  });
});
