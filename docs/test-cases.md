# MedVault-X Backend Test Cases

**Version:** 1.0

This document describes the test cases used to validate the UIDAI Mock Service and Patient Registration Backend.

---

# Test Environment

* Backend: Node.js + Express
* UIDAI Mock Service
* Hyperledger Fabric: Mock Integration (Gateway Pending)
* API Testing Tool: curl / Postman

---

# Test Cases

## TC-01: Valid Demographic Verification

**Objective**

Verify that a valid Aadhaar Number and Date of Birth generate an OTP.

### Input

```json
{
  "aadhaarNumber": "123412341234",
  "dob": "2005-01-01"
}
```

### Expected Result

* HTTP Status: **200 OK**
* Response Status: **OTP_SENT**
* A valid Transaction ID is returned.

**Result:** ✅ Pass

---

## TC-02: Invalid Aadhaar Number

### Input

```json
{
  "aadhaarNumber": "999999999999",
  "dob": "2005-01-01"
}
```

### Expected Result

* HTTP Status: **400 Bad Request**
* Message:

```text
Demographic verification failed
```

**Result:** ✅ Pass

---

## TC-03: Invalid Date of Birth

### Input

```json
{
  "aadhaarNumber": "123412341234",
  "dob": "2000-01-01"
}
```

### Expected Result

* HTTP Status: **400 Bad Request**
* Demographic verification fails.

**Result:** ✅ Pass

---

## TC-04: Successful OTP Verification

### Preconditions

* OTP generated successfully.

### Input

Valid Transaction ID and OTP.

### Expected Result

* HTTP Status: **200 OK**
* VID generated.
* Aadhaar Token generated.
* Patient registration initiated.

**Result:** ✅ Pass

---

## TC-05: Invalid OTP

### Input

Incorrect OTP.

### Expected Result

* HTTP Status: **400 Bad Request**
* Message:

```text
Invalid OTP
```

**Result:** ✅ Pass

---

## TC-06: Expired OTP

### Preconditions

OTP older than 5 minutes.

### Expected Result

* HTTP Status: **400 Bad Request**
* Message:

```text
OTP expired
```

**Result:** ✅ Pass

---

## TC-07: Invalid Transaction ID

### Input

Random Transaction ID.

### Expected Result

* HTTP Status: **400 Bad Request**
* Message:

```text
Invalid transaction ID
```

**Result:** ✅ Pass

---

## TC-08: Missing Registration Fields

### Input

Missing one or more required fields.

Example:

```json
{
  "transactionID": "TXN123",
  "otp": "123456"
}
```

### Expected Result

* HTTP Status: **400 Bad Request**
* Message:

```text
Missing required registration fields.
```

**Result:** ✅ Pass

---

## TC-09: Successful Patient Registration (Mock)

### Preconditions

* Valid OTP
* Valid patient details

### Expected Result

* Patient Fabric Service receives patient data.
* Mock Fabric returns success.
* Backend returns patient registration response.

**Result:** ✅ Pass

---

## TC-10: Duplicate Patient Registration

### Status

Pending (Requires Hyperledger Fabric Gateway Integration)

### Expected Result

* Existing Patient ID detected.
* Registration rejected.

**Expected Status**

Pending

---

## TC-11: Successful Biometric Authentication

### Input

Valid fingerprint template.

### Expected Result

* UIDAI Mock authenticates fingerprint.
* VID generated.
* Aadhaar Token generated.

**Result:** ✅ Pass

---

## TC-12: Invalid Biometric Authentication

### Input

Unknown fingerprint template.

### Expected Result

* HTTP Status: **400 Bad Request**
* Message:

```text
Biometric authentication failed
```

**Result:** ✅ Pass

---

# Overall Test Summary

| Test Case                     | Status    |
| ----------------------------- | --------- |
| Demographic Verification      | ✅ Pass    |
| OTP Generation                | ✅ Pass    |
| OTP Verification              | ✅ Pass    |
| OTP Expiration                | ✅ Pass    |
| Missing Input Validation      | ✅ Pass    |
| Patient Registration API      | ✅ Pass    |
| Biometric Authentication      | ✅ Pass    |
| Duplicate Patient Detection   | ⏳ Pending |
| Hyperledger Fabric Submission | ⏳ Pending |

---

# Remarks

* All UIDAI Mock APIs function as expected.
* OTP expiration is successfully enforced.
* Backend validation rejects incomplete requests.
* Patient registration currently uses a mock Fabric service.
* Final end-to-end validation will be performed after Hyperledger Fabric Gateway integration.
