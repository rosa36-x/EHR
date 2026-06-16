# MedVault-X Asset Schema Specification

Version: 1.0

This document defines all ledger assets used within MedVault-X. These schemas serve as the source of truth for Go models, chaincode logic, and API interactions.

---

# 1. Patient Asset

## Purpose

Stores patient identity and Aadhaar-derived identifiers.

## Storage

PatientRecordCollection

## Primary Key

patientID

| Field        | Type   |
| ------------ | ------ |
| patientID    | string |
| fullName     | string |
| dob          | string |
| gender       | string |
| aadhaarVID   | string |
| aadhaarToken | string |
| phone        | string |
| email        | string |
| createdAt    | string |
| updatedAt    | string |

---

# 2. Consent Asset

## Purpose

Stores patient consent permissions for healthcare data access.

## Storage

ConsentCollection

## Primary Key

consentID

| Field        | Type   |
| ------------ | ------ |
| consentID    | string |
| patientID    | string |
| granteeOrg   | string |
| resourceType | string |
| permission   | string |
| status       | string |
| expiryDate   | string |
| createdAt    | string |
| updatedAt    | string |

---

# 3. Consultation Asset

## Purpose

Stores consultation metadata and document references.

## Storage

PatientRecordCollection

## Primary Key

consultationID

| Field            | Type   |
| ---------------- | ------ |
| consultationID   | string |
| patientID        | string |
| doctorID         | string |
| diagnosis        | string |
| consultationCID  | string |
| consultationHash | string |
| encryptionKeyRef | string |
| timestamp        | string |
| createdAt        | string |
| updatedAt        | string |

---

# 4. Prescription Asset

## Purpose

Stores prescription metadata and dispensing information.

## Storage

PrescriptionCollection

## Primary Key

prescriptionID

| Field            | Type   |
| ---------------- | ------ |
| prescriptionID   | string |
| patientID        | string |
| doctorID         | string |
| prescriptionCID  | string |
| prescriptionHash | string |
| encryptionKeyRef | string |
| status           | string |
| issuedAt         | string |
| dispensedAt      | string |
| createdAt        | string |
| updatedAt        | string |

---

# 5. LabReport Asset

## Purpose

Stores laboratory report metadata.

## Storage

LabReportCollection

## Primary Key

reportID

| Field      | Type   |
| ---------- | ------ |
| reportID   | string |
| patientID  | string |
| labTechID  | string |
| reportType | string |
| reportCID  | string |
| reportHash | string |
| encryptionKeyRef | string |
| status     | string |
| createdAt  | string |
| updatedAt  | string |

---

# 6. AuditLog Asset

## Purpose

Maintains immutable audit trails of all sensitive actions.

## Storage

Public Ledger

## Primary Key

auditID

| Field        | Type   |
| ------------ | ------ |
| auditID      | string |
| actorID      | string |
| actorRole    | string |
| action       | string |
| resourceType | string |
| resourceID   | string |
| timestamp    | string |

---

# 7. EmergencyAccess Asset

## Purpose

Records break-glass emergency access events.

## Storage

Public Ledger

## Primary Key

emergencyAccessID

| Field             | Type   |
| ----------------- | ------ |
| emergencyAccessID | string |
| patientID         | string |
| doctorID          | string |
| reason            | string |
| status            | string |
| timestamp         | string |

---

# 8. Referral Asset

## Purpose

Stores referrals between healthcare providers.

## Storage

Public Ledger

## Primary Key

referralID

| Field          | Type   |
| -------------- | ------ |
| referralID     | string |
| patientID      | string |
| fromDoctorID   | string |
| toDoctorID     | string |
| referralCID    | string |
| referralHash   | string |
| encryptionKeyRef | string |
| referralReason | string |
| createdAt      | string |
| updatedAt      | string |

---

# Asset ID Conventions

| Asset            | Prefix |
| ---------------- | ------ |
| Patient          | PAT    |
| Consent          | CON    |
| Consultation     | CONS   |
| Prescription     | PRE    |
| Lab Report       | LAB    |
| Audit Log        | AUD    |
| Emergency Access | EA     |
| Referral         | REF    |

Examples:

PAT0001
CON0001
CONS0001
PRE0001
LAB0001
AUD0001
EA0001
REF0001
