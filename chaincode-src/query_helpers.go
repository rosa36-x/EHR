package main

import (
	"encoding/json"
	"fmt"
	"strings"
	
	"github.com/hyperledger/fabric-contract-api-go/contractapi"
	"github.com/rosa36-x/EHR/chaincode/models"
	"github.com/rosa36-x/EHR/chaincode/policy"
)

// query_helpers.go — additive, read-only list/search functions.
//
// Nothing here creates, updates, or deletes any asset, and nothing here
// touches an existing PDC key, collection, or policy entry. Every function
// reuses the exact same policy name as its single-record GET counterpart
// (e.g. GetConsultationsByPatient reuses "GET_CONSULTATION"), since the set
// of orgs allowed to read a resource type is identical whether they're
// reading one record or many.
//
// Two query shapes, depending on where a resource actually lives:
//   - PDC-backed resources (Consultation, Prescription, LabReport, Consent,
//     Patient) use GetPrivateDataByRange over that collection.
//   - World-state resources (Referral, PermissionRequest,
//     TreatmentRelationship, AuditLog) use GetStateByRange.
//
// A few resources share their key space with composite "index" keys used
// internally for fast single-lookup checks (e.g. TR_IDX_..., PREQ_IDX_...,
// CON_IDX_...). Those are skipped during iteration — they're pointers, not
// full records, and would fail JSON unmarshaling into the resource struct.

func isIndexKey(key string) bool {
	return strings.Contains(key, "_IDX_") || strings.HasPrefix(key, "CFLAG_")
}

// ── Consultation (PDC: PatientRecordCollection, prefix CONS_) ─────────────

func (s *SmartContract) GetConsultationsByPatient(
	ctx contractapi.TransactionContextInterface,
	patientID string,
) ([]*models.Consultation, error) {
	if err := policy.EnforcePolicy(ctx, "GET_CONSULTATION"); err != nil {
		return nil, err
	}

	iterator, err := ctx.GetStub().GetPrivateDataByRange(PatientCollection, "CONS_", "CONS_~")
	if err != nil {
		return nil, err
	}
	defer iterator.Close()

	var results []*models.Consultation
	for iterator.HasNext() {
		item, err := iterator.Next()
		if err != nil {
			return nil, err
		}
		if isIndexKey(item.Key) {
			continue
		}
		var c models.Consultation
		if err := json.Unmarshal(item.Value, &c); err != nil {
			continue
		}
		if c.PatientID == patientID {
			results = append(results, &c)
		}
	}
	return results, nil
}

// ── Prescription (PDC: PrescriptionCollection, prefix PRE_) ───────────────

func (s *SmartContract) GetPrescriptionsByPatient(
	ctx contractapi.TransactionContextInterface,
	patientID string,
) ([]*models.Prescription, error) {
	if err := policy.EnforcePolicy(ctx, "GET_PRESCRIPTION"); err != nil {
		return nil, err
	}
	// Unlike the single-record GetPrescription, this list function has no
	// per-record consent check — so it's restricted to Hospital only. A
	// Pharmacy/Lab actor must look up one prescription by ID, which goes
	// through the existing HasActiveConsent gate.
	clientMSPID, err := ctx.GetClientIdentity().GetMSPID()
	if err != nil {
		return nil, err
	}
	if clientMSPID != "HospitalMSP" {
		return nil, fmt.Errorf("only HospitalMSP may list all prescriptions for a patient; other orgs must look up a specific prescription by ID")
	}

	iterator, err := ctx.GetStub().GetPrivateDataByRange(PrescriptionCollection, "", "")
	if err != nil {
		return nil, err
	}
	defer iterator.Close()

	var results []*models.Prescription
	for iterator.HasNext() {
		item, err := iterator.Next()
		if err != nil {
			return nil, err
		}
		if isIndexKey(item.Key) {
			continue
		}
		var p models.Prescription
		if err := json.Unmarshal(item.Value, &p); err != nil {
			continue
		}
		if p.PatientID == patientID {
			results = append(results, &p)
		}
	}
	return results, nil
}

// ── LabReport (PDC: LabReportCollection, prefix LAB_) ──────────────────────

func (s *SmartContract) GetLabReportsByPatient(
	ctx contractapi.TransactionContextInterface,
	patientID string,
) ([]*models.LabReport, error) {
	if err := policy.EnforcePolicy(ctx, "GET_LAB_REPORT"); err != nil {
		return nil, err
	}
	clientMSPID, err := ctx.GetClientIdentity().GetMSPID()
	if err != nil {
		return nil, err
	}
	if clientMSPID != "HospitalMSP" {
		return nil, fmt.Errorf("only HospitalMSP may list all lab reports for a patient; other orgs must look up a specific report by ID")
	}

	iterator, err := ctx.GetStub().GetPrivateDataByRange(LabReportCollection, "", "")
	if err != nil {
		return nil, err
	}
	defer iterator.Close()

	var results []*models.LabReport
	for iterator.HasNext() {
		item, err := iterator.Next()
		if err != nil {
			return nil, err
		}
		if isIndexKey(item.Key) {
			continue
		}
		var l models.LabReport
		if err := json.Unmarshal(item.Value, &l); err != nil {
			continue
		}
		if l.PatientID == patientID {
			results = append(results, &l)
		}
	}
	return results, nil
}

// ── Consent (PDC: ConsentCollection, prefix CON_; skips CON_IDX_) ─────────

func (s *SmartContract) GetConsentsByPatient(
	ctx contractapi.TransactionContextInterface,
	patientID string,
) ([]*models.Consent, error) {
	if err := policy.EnforcePolicy(ctx, "GET_CONSENT"); err != nil {
		return nil, err
	}

	iterator, err := ctx.GetStub().GetPrivateDataByRange(ConsentCollection, "CON_", "CON_~")
	if err != nil {
		return nil, err
	}
	defer iterator.Close()

	var results []*models.Consent
	for iterator.HasNext() {
		item, err := iterator.Next()
		if err != nil {
			return nil, err
		}
		if isIndexKey(item.Key) {
			continue
		}
		var c models.Consent
		if err := json.Unmarshal(item.Value, &c); err != nil {
			continue
		}
		if c.PatientID == patientID {
			results = append(results, &c)
		}
	}
	return results, nil
}

// ── Referral (world state, prefix REF_) ────────────────────────────────────

func (s *SmartContract) GetReferralsByDoctor(
	ctx contractapi.TransactionContextInterface,
	doctorID string,
	direction string, // "from", "to", or "" for either
) ([]*models.Referral, error) {
	if err := policy.EnforcePolicy(ctx, "GET_REFERRAL"); err != nil {
		return nil, err
	}

	iterator, err := ctx.GetStub().GetStateByRange("REF_", "REF_~")
	if err != nil {
		return nil, err
	}
	defer iterator.Close()

	var results []*models.Referral
	for iterator.HasNext() {
		item, err := iterator.Next()
		if err != nil {
			return nil, err
		}
		var r models.Referral
		if err := json.Unmarshal(item.Value, &r); err != nil {
			continue
		}
		matches := (direction == "from" && r.FromDoctorID == doctorID) ||
			(direction == "to" && r.ToDoctorID == doctorID) ||
			(direction == "" && (r.FromDoctorID == doctorID || r.ToDoctorID == doctorID))
		if matches {
			results = append(results, &r)
		}
	}
	return results, nil
}

// ── PermissionRequest (world state, prefix PREQ_; skips PREQ_IDX_) ────────

func (s *SmartContract) GetPermissionRequestsByPatient(
	ctx contractapi.TransactionContextInterface,
	patientID string,
) ([]*models.PermissionRequest, error) {
	if err := policy.EnforcePolicy(ctx, "GET_PERMISSION_REQUEST"); err != nil {
		return nil, err
	}
	return queryPermissionRequests(ctx, func(p *models.PermissionRequest) bool {
		return p.PatientID == patientID
	})
}

func (s *SmartContract) GetPermissionRequestsByDoctor(
	ctx contractapi.TransactionContextInterface,
	doctorID string,
) ([]*models.PermissionRequest, error) {
	if err := policy.EnforcePolicy(ctx, "GET_PERMISSION_REQUEST"); err != nil {
		return nil, err
	}
	return queryPermissionRequests(ctx, func(p *models.PermissionRequest) bool {
		return p.DoctorID == doctorID
	})
}

func queryPermissionRequests(
	ctx contractapi.TransactionContextInterface,
	match func(*models.PermissionRequest) bool,
) ([]*models.PermissionRequest, error) {
	iterator, err := ctx.GetStub().GetStateByRange("PREQ_", "PREQ_~")
	if err != nil {
		return nil, err
	}
	defer iterator.Close()

	var results []*models.PermissionRequest
	for iterator.HasNext() {
		item, err := iterator.Next()
		if err != nil {
			return nil, err
		}
		if isIndexKey(item.Key) {
			continue
		}
		var p models.PermissionRequest
		if err := json.Unmarshal(item.Value, &p); err != nil {
			continue
		}
		if match(&p) {
			results = append(results, &p)
		}
	}
	return results, nil
}

// ── TreatmentRelationship (world state, prefix TR_; skips TR_IDX_) ────────

func (s *SmartContract) GetTreatmentRelationshipsByDoctor(
	ctx contractapi.TransactionContextInterface,
	doctorID string,
) ([]*models.TreatmentRelationship, error) {
	if err := policy.EnforcePolicy(ctx, "GET_TREATMENT_RELATIONSHIP"); err != nil {
		return nil, err
	}
	return queryTreatmentRelationships(ctx, func(t *models.TreatmentRelationship) bool {
		return t.DoctorID == doctorID
	})
}

func (s *SmartContract) GetTreatmentRelationshipsByPatient(
	ctx contractapi.TransactionContextInterface,
	patientID string,
) ([]*models.TreatmentRelationship, error) {
	if err := policy.EnforcePolicy(ctx, "GET_TREATMENT_RELATIONSHIP"); err != nil {
		return nil, err
	}
	return queryTreatmentRelationships(ctx, func(t *models.TreatmentRelationship) bool {
		return t.PatientID == patientID
	})
}

func queryTreatmentRelationships(
	ctx contractapi.TransactionContextInterface,
	match func(*models.TreatmentRelationship) bool,
) ([]*models.TreatmentRelationship, error) {
	iterator, err := ctx.GetStub().GetStateByRange("TR_", "TR_~")
	if err != nil {
		return nil, err
	}
	defer iterator.Close()

	var results []*models.TreatmentRelationship
	for iterator.HasNext() {
		item, err := iterator.Next()
		if err != nil {
			return nil, err
		}
		if isIndexKey(item.Key) {
			continue
		}
		var t models.TreatmentRelationship
		if err := json.Unmarshal(item.Value, &t); err != nil {
			continue
		}
		if match(&t) {
			results = append(results, &t)
		}
	}
	return results, nil
}

// ── AuditLog (world state, prefix AUD_) ─────────────────────────────────────

func (s *SmartContract) GetAuditLogsByActor(
	ctx contractapi.TransactionContextInterface,
	actorID string,
) ([]*models.AuditLog, error) {
	if err := policy.EnforcePolicy(ctx, "GET_AUDIT_LOG"); err != nil {
		return nil, err
	}
	return queryAuditLogs(ctx, func(a *models.AuditLog) bool {
		return a.ActorID == actorID
	})
}

func (s *SmartContract) GetAuditLogsByResource(
	ctx contractapi.TransactionContextInterface,
	resourceType string,
	resourceID string,
) ([]*models.AuditLog, error) {
	if err := policy.EnforcePolicy(ctx, "GET_AUDIT_LOG"); err != nil {
		return nil, err
	}
	return queryAuditLogs(ctx, func(a *models.AuditLog) bool {
		return a.ResourceType == resourceType && a.ResourceID == resourceID
	})
}

func queryAuditLogs(
	ctx contractapi.TransactionContextInterface,
	match func(*models.AuditLog) bool,
) ([]*models.AuditLog, error) {
	iterator, err := ctx.GetStub().GetStateByRange("AUD_", "AUD_~")
	if err != nil {
		return nil, err
	}
	defer iterator.Close()

	var results []*models.AuditLog
	for iterator.HasNext() {
		item, err := iterator.Next()
		if err != nil {
			return nil, err
		}
		var a models.AuditLog
		if err := json.Unmarshal(item.Value, &a); err != nil {
			continue
		}
		if match(&a) {
			results = append(results, &a)
		}
	}
	return results, nil
}

// ── Patient search (PDC: PatientRecordCollection, prefix PAT_) ────────────

func (s *SmartContract) SearchPatientsByName(
	ctx contractapi.TransactionContextInterface,
	nameSubstring string,
) ([]*models.Patient, error) {
	if err := policy.EnforcePolicy(ctx, "GET_PATIENT_RECORD"); err != nil {
		return nil, err
	}

	iterator, err := ctx.GetStub().GetPrivateDataByRange(PatientCollection, "PAT_", "PAT_~")
	if err != nil {
		return nil, err
	}
	defer iterator.Close()

	needle := strings.ToLower(nameSubstring)
	var results []*models.Patient
	for iterator.HasNext() {
		item, err := iterator.Next()
		if err != nil {
			return nil, err
		}
		if isIndexKey(item.Key) {
			continue
		}
		var p models.Patient
		if err := json.Unmarshal(item.Value, &p); err != nil {
			continue
		}
		if strings.Contains(strings.ToLower(p.FullName), needle) {
			results = append(results, &p)
		}
	}
	return results, nil
}