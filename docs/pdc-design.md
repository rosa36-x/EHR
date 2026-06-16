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

Contains patient consent grants, revocations, permissions, and access-control information.

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

| Collection              | Required Peer Count | Max Peer Count |
| ----------------------- | ------------------- | -------------- |
| PatientRecordCollection | 1                   | 3              |
| ConsentCollection       | 1                   | 3              |
| PrescriptionCollection  | 1                   | 3              |
| LabReportCollection     | 1                   | 3              |

These values are based on the current deployment architecture where each organization maintains a single peer.
