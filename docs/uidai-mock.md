# UIDAI Mock Service Design

Version: 1.2

This document defines the UIDAI mock service used by MedVault-X for patient identity verification, registration, and emergency patient identification.

---

## Purpose

Real UIDAI APIs are not available for this project. Therefore, MedVault-X implements a mock UIDAI service that simulates identity verification using demographic authentication, OTP verification, and biometric authentication.

The mock service enables secure patient registration and emergency patient identification without storing Aadhaar numbers on the blockchain.

---

## Authentication Methods

### 1. Demographic Authentication

Used during patient registration.

Authentication factors:

* Aadhaar Number
* Date of Birth

---

### 2. OTP Authentication

Used during patient registration.

Authentication factor:

* Aadhaar-linked OTP

---

### 3. Biometric Authentication

Used only during emergency situations when the patient is unable to provide credentials.

Authentication factor:

* Aadhaar-linked Fingerprint

---

## Patient Registration Workflow

```text
Patient Registration
        ↓
Enter Aadhaar Number
Enter Date of Birth
        ↓
Demographic Verification
        ↓
Generate OTP
        ↓
Enter OTP
        ↓
OTP Verification
        ↓
Generate VID
Generate Token
        ↓
Create Patient Asset
        ↓
Store VID + Token on Fabric
```

---

## Emergency Identification Workflow

```text
Unconscious Patient Arrives
        ↓
Fingerprint Scan
        ↓
UIDAI Mock Biometric Authentication
        ↓
Identify Aadhaar Record
        ↓
Retrieve VID / Token
        ↓
Locate Patient Record
        ↓
Grant Emergency Access
        ↓
Create EmergencyAccess Asset
        ↓
Create AuditLog Entry
```

---

## Stage 1: Demographic Verification

The user provides:

* Aadhaar Number
* Date of Birth

The UIDAI mock service validates the information against its internal Aadhaar database.

### Success

```json
{
  "status": "VERIFIED"
}
```

### Failure

```json
{
  "status": "FAILED",
  "message": "Demographic verification failed"
}
```

---

## Stage 2: OTP Verification

After successful demographic verification, the system generates a one-time password (OTP).

The user must enter the OTP to complete authentication.

### Success

```json
{
  "status": "SUCCESS"
}
```

### Failure

```json
{
  "status": "FAILED",
  "message": "Invalid OTP"
}
```

---

## Biometric Authentication

Biometric authentication is used exclusively for emergency patient identification.

Workflow:

```text
Fingerprint Scan
        ↓
Generate Fingerprint Template
        ↓
Compare with Aadhaar-linked Template
        ↓
MATCH / NO MATCH
```

### Success

```json
{
  "status": "SUCCESS",
  "fullName": "Rahul Sharma",
  "aadhaarVID": "VID-AB82CD91EF73",
  "aadhaarToken": "TOK-7A2B9F4D8E3C"
}
```

### Failure

```json
{
  "status": "FAILED",
  "message": "Biometric authentication failed"
}
```

---

## Mock Aadhaar Database Structure

Example:

```json
[
  {
    "aadhaarNumber": "123412341234",
    "fullName": "Rahul Sharma",
    "dob": "2005-01-01",
    "phone": "9876543210",
    "fingerprintTemplate": "FP_TEMPLATE_001"
  },
  {
    "aadhaarNumber": "567856785678",
    "fullName": "Priya Nair",
    "dob": "2004-06-15",
    "phone": "9123456780",
    "fingerprintTemplate": "FP_TEMPLATE_002"
  }
]
```

The database is used for:

* Demographic verification
* OTP delivery simulation
* Biometric authentication

---

## Temporary OTP Storage

Generated OTPs are maintained only in temporary server memory.

Example:

```json
{
  "TXN001": {
    "otp": "482913",
    "aadhaarNumber": "123412341234",
    "expiresAt": "2026-06-16T12:00:00Z"
  }
}
```

OTP records automatically expire after 5 minutes.

OTP records are deleted after:

* Successful verification
* Expiration

OTPs are never stored on Fabric, IPFS, or patient records.

---
## VID Generation Strategy

After successful OTP verification, a Virtual ID (VID) is generated.

Example:

```text
VID-AB82CD91EF73
```

Purpose:

* Prevent storage of Aadhaar numbers
* Simulate UIDAI Virtual ID functionality
* Provide a privacy-preserving identity reference

---

## Token Generation Strategy

After successful OTP verification, an Aadhaar token is generated.

Example:

```text
TOK-7A2B9F4D8E3C
```

Purpose:

* Provide a tokenized representation of identity
* Avoid exposure of Aadhaar numbers
* Simulate UIDAI tokenization concepts

---

## API Specification

### GET /health

Health check endpoint used to verify that the UIDAI mock service is running.

#### Response

```json
{
  "status": "UIDAI Mock Service Active"
}
```

---
### POST /authenticate

Performs demographic verification and generates an OTP.

#### Request

```json
{
  "aadhaarNumber": "123412341234",
  "dob": "2005-01-01"
}
```

#### Response

```json
{
  "status": "OTP_SENT",
  "transactionID": "TXN001"
}
```

---

### POST /verify-otp

Verifies the OTP and returns UIDAI-derived identifiers.

#### Request

```json
{
  "transactionID": "TXN001",
  "otp": "482913"
}
```

#### Response

```json
{
  "status": "SUCCESS",
  "aadhaarVID": "VID-AB82CD91EF73",
  "aadhaarToken": "TOK-7A2B9F4D8E3C"
}
```

---

### POST /authenticate-biometric

Performs Aadhaar-linked biometric authentication for emergency patient identification.

#### Request

```json
{
  "fingerprintTemplate": "FP_TEMPLATE_001"
}
```

#### Response

```json
{
  "status": "SUCCESS",
  "fullName": "Rahul Sharma",
  "aadhaarVID": "VID-AB82CD91EF73",
  "aadhaarToken": "TOK-7A2B9F4D8E3C"
}
```

---

## Data Stored on Blockchain

The following fields are stored in the Patient asset:

```json
{
  "aadhaarVID": "VID-AB82CD91EF73",
  "aadhaarToken": "TOK-7A2B9F4D8E3C"
}
```

---

## Data Not Stored on Blockchain

The following information must never be stored on Fabric:

```text
Aadhaar Number
OTP
Transaction IDs
Phone Number
Fingerprint Templates
```

---

## Security Assumptions

* OTPs are temporary and short-lived.
* OTPs are maintained only in server memory.
* OTPs automatically expire after 5 minutes.
* Aadhaar numbers remain within the UIDAI mock service.
* Fingerprint templates remain within the UIDAI mock service.
* Blockchain records store only VID and tokenized identifiers.
* No real UIDAI infrastructure or APIs are used.
* Biometric authentication is simulated using Aadhaar-linked fingerprint templates.
