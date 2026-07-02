/**
 * __mocks__/treatmentRelationshipFabricService.js
 *
 * Domain-level mock matching the real treatmentRelationshipFabricService.js
 * exports exactly: TreatmentRelationshipTypes, createTreatmentRelationship,
 * getTreatmentRelationship, hasActiveTreatmentRelationship, dischargePatient,
 * markDormant, reactivateTreatmentRelationship.
 *
 * Note the real export is `reactivateTreatmentRelationship`, not `reactivate`.
 */

'use strict';

let _seq = 1;
const nextID = (prefix) => `${prefix}${String(_seq++).padStart(4, '0')}`;
const SUCCESS = (extra = {}) => ({ status: 'SUCCESS', ...extra });

const TreatmentRelationshipTypes = [
  'RECENT_APPOINTMENT',
  'FOLLOW_UP_CHECKUP',
  'ONGOING_TREATMENT',
  'REFERRED_BY_DOCTOR',
  'ASSIGNED_EMERGENCY_PHYSICIAN',
];

const createTreatmentRelationship = jest.fn(async () => SUCCESS({ relationshipID: nextID('TR') }));

const getTreatmentRelationship = jest.fn(async (relationshipID) => SUCCESS({
  data: { relationshipID, status: 'ACTIVE' },
}));

const hasActiveTreatmentRelationship = jest.fn(async () => true);

const dischargePatient = jest.fn(async (relationshipID) => SUCCESS({ relationshipID }));

const markDormant = jest.fn(async (relationshipID) => SUCCESS({ relationshipID }));

const reactivateTreatmentRelationship = jest.fn(async (relationshipID) => SUCCESS({ relationshipID }));

const __resetAll = () => {
  [
    createTreatmentRelationship, getTreatmentRelationship, hasActiveTreatmentRelationship,
    dischargePatient, markDormant, reactivateTreatmentRelationship,
  ].forEach((fn) => fn.mockClear());
  _seq = 1;
};

module.exports = {
  TreatmentRelationshipTypes,
  createTreatmentRelationship,
  getTreatmentRelationship,
  hasActiveTreatmentRelationship,
  dischargePatient,
  markDormant,
  reactivateTreatmentRelationship,
  __resetAll,
};
