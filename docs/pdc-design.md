# MedVault-X Private Data Collection Design

Version: 1.0

This document defines the storage policy for all assets in the MedVault-X Hyperledger Fabric network.

---

# Collection Configuration

## PatientRecordCollection

### Members

* HospitalMSP

### Stores

* Patient
* Consultation

### Purpose

Contains highly sensitive patient identity information, Aadhaar-derived identifiers, and consultation metadata.

---

## ConsentCollection

### Members

* HospitalMSP

### Stores

* Consent

### Purpose

Contains patient consent grants, revocations, permissions, and access-control information. Only HospitalMSP is a member — PharmacyMSP/LaboratoryMSP identities cannot read this collection at all, by design (see the two flag collections below for how they get a cross-org access decision without it).

---

## PharmacyConsentFlagCollection

### Members

* HospitalMSP
* PharmacyMSP

### Stores

* ConsentFlag (minimal mirror: `status`, `expiryDate` only — no `permission`, `consentID`, or other Consent fields)

### Purpose

Lets a PharmacyMSP identity answer "do I have active consent for this patient/resourceType?" without ever being a member of ConsentCollection. Written by GrantConsent/RevokeConsent whenever `granteeOrg == "PharmacyMSP"`; read by HasActiveConsent from inside GetPrescription when the caller is PharmacyMSP. Only reflects grants actually made to Pharmacy — never other orgs' or other patients' consent.

---

## LaboratoryConsentFlagCollection

### Members

* HospitalMSP
* LaboratoryMSP

### Stores

* ConsentFlag (same minimal shape as above)

### Purpose

Same as PharmacyConsentFlagCollection, scoped to `granteeOrg == "LaboratoryMSP"`. Not currently read by any chaincode function — `GET_LAB_REPORT` policy doesn't allow a cross-org (non-Hospital/Laboratory) caller yet, so nothing calls HasActiveConsent for lab reports today. Present for symmetry/future use if a third org needs lab-report access under consent.

---

## PrescriptionCollection

### Members

* HospitalMSP
* PharmacyMSP

### Stores

* Prescription

### Purpose

Allows pharmacies to verify and dispense prescriptions while preserving privacy from other organizations.

---

## LabReportCollection

### Members

* HospitalMSP
* LaboratoryMSP

### Stores

* LabReport

### Purpose

Allows laboratories and hospitals to securely exchange diagnostic reports and metadata.

---

# Public Ledger Assets

The following assets are stored on the channel ledger and are visible to all participating organizations.

## AuditLog

Reason:

* Provides immutable accountability.
* Supports compliance and forensic analysis.

---

## EmergencyAccess

Reason:

* Stores break-glass access records.
* Ensures emergency actions remain auditable.

---

## Referral

Reason:

* Stores referral workflow metadata.
* Sensitive documents remain in IPFS while only metadata is recorded on-chain.

---

# Chaincode Ownership Mapping

| Asset           | Chaincode             | Storage Location        |
| --------------- | --------------------- | ----------------------- |
| Patient         | PatientChaincode      | PatientRecordCollection |
| Consent         | ConsentChaincode      | ConsentCollection       |
| Consultation    | ConsultationChaincode | PatientRecordCollection |
| Prescription    | PrescriptionChaincode | PrescriptionCollection  |
| LabReport       | LabChaincode          | LabReportCollection     |
| AuditLog        | AuditChaincode        | Public Ledger           |
| EmergencyAccess | EmergencyChaincode    | Public Ledger           |
| Referral        | ReferralChaincode     | Public Ledger           |

---

# Current Collection Parameters

| Collection                       | Required Peer Count | Max Peer Count |
| --------------------------------- | -------------------- | -------------- |
| PatientRecordCollection           | 0                     | 3              |
| ConsentCollection                 | 0                     | 3              |
| PharmacyConsentFlagCollection     | 0                     | 3              |
| LaboratoryConsentFlagCollection   | 0                     | 3              |
| PrescriptionCollection            | 0                     | 3              |
| LabReportCollection               | 0                     | 3              |

Required Peer Count is 0 (not 1) across all collections — single-peer-per-org
topology, so requiring endorsement from a second peer of the same org isn't
possible. This table previously listed 1 for the original four collections;
corrected to match the actual `collections_config.json`, which has used 0
since the single-peer-per-org fix.

These values are based on the current deployment architecture where each organization maintains a single peer.
