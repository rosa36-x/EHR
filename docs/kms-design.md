# KMS Design Specification

Version: 1.0

This document defines the Key Management Service (KMS) architecture used by MedVault-X for secure encryption and decryption of healthcare documents stored in IPFS.

---

# Purpose

MedVault-X stores healthcare documents in IPFS. To ensure confidentiality and prevent unauthorized access, all documents are encrypted before upload.

The KMS is responsible for:

* Generating encryption keys
* Managing encryption keys
* Providing keys for authorized decryption operations
* Maintaining separation between document storage and key storage

The KMS never stores healthcare documents.

---

# Architecture Overview

```text
Hyperledger Fabric
        ↓
Metadata & Access Control

IPFS
        ↓
Encrypted Healthcare Documents

KMS
        ↓
Encryption Keys
```

---

# Documents Protected by KMS

The following document types are encrypted before upload to IPFS:

* Consultation Documents
* Prescriptions
* Lab Reports
* Referrals

---

# Encryption Algorithm

Algorithm:

```text
AES-256
```

Purpose:

* Encrypt healthcare documents before IPFS upload
* Protect patient confidentiality
* Prevent unauthorized document access

---

# Key Ownership Model

MedVault-X uses a centralized KMS architecture.

```text
KMS
 ↓
Owns and manages all encryption keys
```

Healthcare organizations do not directly store encryption keys.

Patients do not directly manage encryption keys.

---

# Key Generation Strategy

A unique encryption key is generated for every document uploaded.

Examples:

```text
Consultation Document A → KEY001
Consultation Document B → KEY002
Prescription Document A → KEY003
Lab Report A → KEY004
Referral Document A → KEY005
```

This minimizes risk because compromise of one key affects only one document.

---

# Key Reference Format

Encryption keys are never stored on the blockchain.

Instead, assets store a key reference.

Examples:

```text
KEY001
KEY002
KEY003
```

Stored in Fabric as:

```json
{
  "encryptionKeyRef": "KEY001"
}
```

---

# KMS Storage Structure

Example:

```json
{
  "keyID": "KEY001",
  "algorithm": "AES-256",
  "status": "ACTIVE",
  "createdAt": "2026-06-16T10:00:00Z"
}
```

The actual encryption key remains inside the KMS and is never stored on Fabric or IPFS.

---

# Document Upload Workflow

```text
Healthcare Document
        ↓
KMS Generates AES Key
        ↓
Document Encryption
        ↓
Encrypted Document
        ↓
Upload to IPFS
        ↓
Receive CID
        ↓
Store Metadata on Fabric
```

Example metadata:

```json
{
  "consultationCID": "QmXYZ123",
  "consultationHash": "abc123",
  "encryptionKeyRef": "KEY001"
}
```

---

# Document Retrieval Workflow

```text
User Requests Document
        ↓
Fabric Permission Check
        ↓
Retrieve CID
        ↓
Retrieve encryptionKeyRef
        ↓
Download Encrypted File from IPFS
        ↓
Request Key from KMS
        ↓
Decrypt Document
        ↓
Return Original Document
```

---

# Asset Integration

The following assets contain an encryption key reference:

* Consultation
* Prescription
* LabReport
* Referral

Example:

```json
{
  "consultationID": "CONS0001",
  "consultationCID": "QmXYZ123",
  "consultationHash": "abc123",
  "encryptionKeyRef": "KEY001"
}
```

---

# Security Assumptions

* Documents are encrypted before upload to IPFS.
* Encryption keys are never stored on Hyperledger Fabric.
* Encryption keys are never stored in IPFS.
* The KMS is the sole authority for key generation and key retrieval.
* Access control decisions are enforced through Hyperledger Fabric chaincode and consent policies.
* Unauthorized users cannot decrypt encrypted healthcare documents even if they obtain the CID.

---

# Out of Scope

The following features are not included in Version 1.0:

* Key rotation
* Hardware Security Module (HSM) integration
* Multi-region KMS deployment
* Attribute-based key management

These features may be considered in future versions of MedVault-X.
