/**
 * __mocks__/notificationService.js
 *
 * Replaces the real MSG91 / Nodemailer notification service for all tests.
 * Stores every call so tests can assert on what was "sent" without hitting
 * any external service.
 *
 * NotificationEvents is copied verbatim from the real notificationService.js —
 * every *FabricService.js file imports and calls these (e.g.
 * NotificationEvents.RECORD_ACCESSED(...)) as part of its normal, real
 * business logic, so they must exist here or those calls throw.
 *
 * Usage in a test file:
 *   jest.mock('.../backend/services/notificationService', () => require('../__mocks__/notificationService'));
 *   const notify = require('.../backend/services/notificationService');
 *   expect(notify.sendSMS).toHaveBeenCalledWith(...);
 *   notify.__clearCalls();
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

const notify = jest.fn(async ({ recipientID, recipientRole, phone, email, event, message, channel = 'sms' }) => {
  let status = 'SENT';

  if (channel === 'sms' || channel === 'both') {
    const result = await sendSMS(phone, message);
    if (result.status !== 'SUCCESS') status = 'FAILED';
  }
  if ((channel === 'email' || channel === 'both') && email) {
    const result = await sendEmail(email, `MedVault — ${event}`, message);
    if (result.status !== 'SUCCESS') status = 'FAILED';
  }

  return { status };
});

/** Copied verbatim from the real notificationService.js — pure string builders, no side effects. */
const NotificationEvents = {
  RECORD_ACCESSED: (resourceType, doctorName) =>
    `Your ${resourceType} record was accessed by Dr. ${doctorName}.`,

  SENSITIVE_RECORD_ACCESS_REQUEST: (doctorName, resourceType) =>
    `Dr. ${doctorName} has requested access to your sensitive ${resourceType} record. You have 24 hours to approve or reject.`,

  PERMISSION_GRANTED: (patientName, resourceType) =>
    `${patientName} has approved your request to access their ${resourceType} record.`,

  PERMISSION_REJECTED: (patientName, resourceType) =>
    `${patientName} has rejected your request to access their ${resourceType} record.`,

  PERMISSION_EXPIRED: (resourceType) =>
    `Your access request for ${resourceType} record has expired with no patient response.`,

  CONSENT_GRANTED: (granteeOrg, resourceType) =>
    `You have granted ${granteeOrg} access to your ${resourceType} records.`,

  CONSENT_REVOKED: (granteeOrg, resourceType) =>
    `Your consent for ${granteeOrg} to access your ${resourceType} records has been revoked.`,

  PRESCRIPTION_DISPENSED: (prescriptionID) =>
    `Your prescription ${prescriptionID} has been dispensed by the pharmacy.`,

  LAB_REPORT_UPLOADED: (reportType) =>
    `Your ${reportType} lab report has been uploaded and is now available.`,

  EMERGENCY_ACCESS: (doctorName, reason) =>
    `Emergency access to your records was granted to Dr. ${doctorName}. Reason: ${reason}.`,

  TREATMENT_RELATIONSHIP_ENDED: (doctorName) =>
    `Your treatment relationship with Dr. ${doctorName} has ended. Their access to your records has been revoked.`,
};

/** Reset recorded calls between tests — call in beforeEach / afterEach. */
const __clearCalls = () => {
  _calls.sms.length   = 0;
  _calls.email.length = 0;
  sendSMS.mockClear();
  sendEmail.mockClear();
  notify.mockClear();
};

/** Inspect recorded calls directly if needed. */
const __getCalls = () => ({ ..._calls });

module.exports = { sendSMS, sendEmail, notify, NotificationEvents, __clearCalls, __getCalls };
