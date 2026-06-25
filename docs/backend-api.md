# MedVault-X Backend API Documentation

**Version:** 1.0

This document describes the backend REST APIs implemented for patient registration and UIDAI mock integration in MedVault-X.

---

# Base URL

```text
http://localhost:5000
```

---

# Patient Registration Workflow

```text
Patient
    │
    ▼
POST /patients/initiate-registration
    │
    ▼
UIDAI Demographic Verification
    │
    ▼
OTP Generated
    │
    ▼
POST /patients/complete-registration
    │
    ▼
OTP Verification
    │
    ▼
Generate VID & Aadhaar Token
    │
    ▼
Patient Registration (Patient Fabric Service)
    │
    ▼
(Hyperledger Fabric Gateway - Pending)
```

---

# API Endpoints

## 1. Initiate Patient Registration

**Endpoint**

```http
POST /patients/initiate-registration
```

### Description

Performs demographic verification using the UIDAI Mock Service and generates a One-Time Password (OTP).

---

### Request Body

```json
{
  "aadhaarNumber": "123412341234",
  "dob": "2005-01-01"
}
```

---

### Success Response

**HTTP 200**

```json
{
  "status": "OTP_SENT",
  "transactionID": "TXN1782275607974"
}
```

---

### Failure Response

**HTTP 400**

```json
{
  "status": "FAILED",
  "message": "Demographic verification failed"
}
```

---

## 2. Complete Patient Registration

**Endpoint**

```http
POST /patients/complete-registration
```

### Description

Verifies the OTP received from the UIDAI Mock Service and registers the patient in the backend.

---

### Request Body

```json
{
  "transactionID": "TXN1782275607974",
  "otp": "482913",
  "patientID": "P001",
  "fullName": "Alice Johnson",
  "dob": "2005-01-01",
  "gender": "F",
  "phone": "9876543210",
  "email": "alice@example.com"
}
```

---

### Success Response

**HTTP 200**

```json
{
  "status": "SUCCESS",
  "message": "Patient registered successfully.",
  "patient": {
    "patientID": "P001",
    "fullName": "Alice Johnson",
    "aadhaarVID": "VID-XXXXXXXXXXXX",
    "aadhaarToken": "TOK-XXXXXXXXXXXX",
    "registeredAt": "2026-06-25T10:00:00Z"
  }
}
```

---

### Failure Responses

#### Invalid OTP

```json
{
  "status": "FAILED",
  "message": "Invalid OTP"
}
```

---

#### OTP Expired

```json
{
  "status": "FAILED",
  "message": "OTP expired"
}
```

---

#### Invalid Transaction ID

```json
{
  "status": "FAILED",
  "message": "Invalid transaction ID"
}
```

---

#### Missing Required Fields

```json
{
  "status": "FAILED",
  "message": "Missing required registration fields."
}
```

---

# Security Notes

* Aadhaar numbers are never stored on the blockchain.
* OTPs are stored only in temporary server memory.
* OTPs automatically expire after **5 minutes**.
* OTP records are deleted immediately after successful verification.
* Fingerprint templates remain exclusively within the UIDAI Mock Service.
* Only Aadhaar Virtual ID (VID) and Aadhaar Token are forwarded for patient registration.
* Hyperledger Fabric integration will be performed through the **Patient Fabric Service** using the Fabric Gateway.

---

# Current Implementation Status

| Component                      | Status             |
| ------------------------------ | ------------------ |
| UIDAI Demographic Verification | ✅ Completed        |
| OTP Generation                 | ✅ Completed        |
| OTP Verification               | ✅ Completed        |
| OTP Expiration                 | ✅ Completed        |
| Biometric Authentication       | ✅ Completed        |
| Patient Registration Backend   | ✅ Completed        |
| Patient Fabric Service         | ✅ Mock Implemented |
| Fabric Gateway Integration     | ⏳ Pending          |
| Hyperledger Fabric Submission  | ⏳ Pending          |

---

# Future Enhancements

* Integrate Patient Fabric Service with the Hyperledger Fabric Gateway.
* Perform on-chain `CreatePatient` transaction.
* Implement duplicate patient detection.
* Add backend logging and audit trail generation.
* Integrate with frontend registration portal.

