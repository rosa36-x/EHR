/**
 * __mocks__/notificationService.js
 *
 * Replaces the real MSG91 / Nodemailer notification service for all tests.
 * Stores every call so tests can assert on what was "sent" without hitting
 * any external service.
 *
 * Usage in a test file:
 *   jest.mock('../../services/notificationService');
 *   const notificationService = require('../../services/notificationService');
 *
 *   // After triggering an action that should notify:
 *   expect(notificationService.sendSMS).toHaveBeenCalledWith(
 *     expect.stringContaining('9876543210'),
 *     expect.stringContaining('OTP')
 *   );
 *   notificationService.__clearCalls();
 */

'use strict';

const _calls = { sms: [], email: [] };

const sendSMS = jest.fn(async (phone, message) => {
  _calls.sms.push({ phone, message, sentAt: new Date().toISOString() });
  return { status: 'SUCCESS', mode: 'mock', phone, message };
});

const sendEmail = jest.fn(async (to, subject, body) => {
  _calls.email.push({ to, subject, body, sentAt: new Date().toISOString() });
  return { status: 'SUCCESS', mode: 'mock', to, subject };
});

/** Reset recorded calls between tests — call in beforeEach / afterEach. */
const __clearCalls = () => {
  _calls.sms.length   = 0;
  _calls.email.length = 0;
  sendSMS.mockClear();
  sendEmail.mockClear();
};

/** Inspect recorded calls directly if needed. */
const __getCalls = () => ({ ..._calls });

module.exports = { sendSMS, sendEmail, __clearCalls, __getCalls };
