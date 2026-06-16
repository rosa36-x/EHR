# UIDAI Mock Service Design

Version: 1.0

This document defines the UIDAI mock service used by MedVault-X for patient identity verification and registration.

---

## Purpose

Real UIDAI APIs are not available for this project. Therefore, MedVault-X implements a mock UIDAI service that simulates identity verification using demographic authentication and OTP verification.

The mock service enables secure patient registration without storing Aadhaar numbers on the blockchain.

---

## Authentication Workflow

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

## Stage 1: Demographic Verification

The user provides:

- Aadhaar Number
- Date of Birth

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

## Mock Aadhaar Database Structure

Example:

```json
[
  {
    "aadhaarNumber": "123412341234",
    "dob": "2005-01-01",
    "phone": "9876543210"
  },
  {
    "aadhaarNumber": "567856785678",
    "dob": "2004-06-15",
    "phone": "9123456780"
  }
]
```

The database is used solely for demographic verification and OTP delivery simulation.

---

## Temporary OTP Storage

Generated OTPs are maintained only in temporary server memory.

Example:

```json
{
  "TXN001": {
    "otp": "482913",
    "expiresAt": "2026-06-16T12:00:00Z"
  }
}
```

OTP records are deleted after:

- Successful verification
- Expiration

OTPs are never stored on Fabric, IPFS, or patient records.

---

## VID Generation Strategy

After successful OTP verification, a Virtual ID (VID) is generated.

Example:

```text
VID-AB82CD91EF73
```

Purpose:

- Prevent storage of Aadhaar numbers
- Simulate UIDAI Virtual ID functionality
- Provide a privacy-preserving identity reference

---

## Token Generation Strategy

After successful OTP verification, an Aadhaar token is generated.

Example:

```text
TOK-7A2B9F4D8E3C
```

Purpose:

- Provide a tokenized representation of identity
- Avoid exposure of Aadhaar numbers
- Simulate UIDAI tokenization concepts

---

## API Specification

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
```

---

## Security Assumptions

- OTPs are temporary and short-lived.
- OTPs are maintained only in server memory.
- Aadhaar numbers remain within the UIDAI mock service.
- Blockchain records store only VID and tokenized identifiers.
- No real UIDAI infrastructure or APIs are used.