package main

import (
	"encoding/json"
	"fmt"
	"time"

	"github.com/hyperledger/fabric-contract-api-go/contractapi"
	"github.com/rosa36-x/EHR/chaincode/models"
	"github.com/rosa36-x/EHR/chaincode/policy"
)

func treatmentRelationshipKey(relationshipID string) string {
	return "TR_" + relationshipID
}

// doctorPatientIndexKey creates a composite key for
// CheckActiveTreatmentRelationship lookups
func doctorPatientIndexKey(doctorID string, patientID string) string {
	return fmt.Sprintf("TR_IDX_%s_%s", doctorID, patientID)
}

// trPairIndexObjectType namespaces the per-relationship pair index. One entry
// is written per (doctor, patient, relationship). The legacy
// TR_IDX_<doctor>_<patient> key held a single relationship ID per pair, so a
// second relationship for the same pair (e.g. an emergency episode opened
// while an ongoing-care relationship existed) overwrote the first, and
// closing the second then revoked the doctor's access under both. Composite
// keys start with U+0000, so they fall outside the "TR_".."TR_~" range scans
// used by the list queries and need no isIndexKey handling.
const trPairIndexObjectType = "TRPAIR"

func trPairIndexKey(
	ctx contractapi.TransactionContextInterface,
	doctorID string,
	patientID string,
	relationshipID string,
) (string, error) {
	return ctx.GetStub().CreateCompositeKey(
		trPairIndexObjectType,
		[]string{doctorID, patientID, relationshipID},
	)
}

// relationshipIsActive is a pure read: ACTIVE and not past DormantAfter.
// An unparseable DormantAfter fails closed.
func relationshipIsActive(ctx contractapi.TransactionContextInterface, relationshipID string) bool {
	relJSON, err := ctx.GetStub().GetState(treatmentRelationshipKey(relationshipID))
	if err != nil || relJSON == nil {
		return false
	}
	var rel models.TreatmentRelationship
	if err := json.Unmarshal(relJSON, &rel); err != nil {
		return false
	}
	if rel.Status != "ACTIVE" {
		return false
	}
	dormant, err := time.Parse(time.RFC3339, rel.DormantAfter)
	return err == nil && !time.Now().After(dormant)
}

func (s *SmartContract) CreateTreatmentRelationship(
	ctx contractapi.TransactionContextInterface,
	relationshipID string,
	patientID string,
	doctorID string,
	relationshipType string,
	notes string,
	status string,
	dormantAfter string,
	createdAt string,
	updatedAt string,
) error {
	err := policy.EnforcePolicy(ctx, "CREATE_TREATMENT_RELATIONSHIP")
	if err != nil {
		return err
	}

	key := treatmentRelationshipKey(relationshipID)

	exists, err := ctx.GetStub().GetState(key)
	if err != nil {
		return err
	}
	if exists != nil {
		return fmt.Errorf("treatment relationship %s already exists", relationshipID)
	}

	// A relationship is born ACTIVE (system-created, e.g. emergency) or
	// PENDING (awaiting patient approval); nothing else is a valid start state.
	if status != "ACTIVE" && status != "PENDING" {
		return fmt.Errorf("status on create must be ACTIVE or PENDING, got %q", status)
	}

	if _, perr := time.Parse(time.RFC3339, dormantAfter); perr != nil {
		return fmt.Errorf("dormantAfter must be RFC3339: %v", perr)
	}

	rel := models.TreatmentRelationship{
		RelationshipID:   relationshipID,
		PatientID:        patientID,
		DoctorID:         doctorID,
		RelationshipType: relationshipType,
		Notes:            notes,
		Status:           status,
		DormantAfter:     dormantAfter,
		CreatedAt:        createdAt,
		UpdatedAt:        updatedAt,
	}

	relJSON, err := json.Marshal(rel)
	if err != nil {
		return err
	}

	// Per-relationship pair index: never overwrites another relationship's
	// entry, and a failed index write now aborts the transaction instead of
	// being silently dropped.
	pairKey, err := trPairIndexKey(ctx, doctorID, patientID, relationshipID)
	if err != nil {
		return err
	}
	if err := ctx.GetStub().PutState(pairKey, []byte(relationshipID)); err != nil {
		return err
	}

	return ctx.GetStub().PutState(key, relJSON)
}

func (s *SmartContract) GetTreatmentRelationship(
	ctx contractapi.TransactionContextInterface,
	relationshipID string,
) (*models.TreatmentRelationship, error) {
	err := policy.EnforcePolicy(ctx, "GET_TREATMENT_RELATIONSHIP")
	if err != nil {
		return nil, err
	}

	key    := treatmentRelationshipKey(relationshipID)
	relJSON, err := ctx.GetStub().GetState(key)
	if err != nil {
		return nil, err
	}
	if relJSON == nil {
		return nil, fmt.Errorf("treatment relationship %s does not exist", relationshipID)
	}

	var rel models.TreatmentRelationship
	err = json.Unmarshal(relJSON, &rel)
	if err != nil {
		return nil, err
	}

	return &rel, nil
}

// CheckActiveTreatmentRelationship checks if a doctor has an
// ACTIVE (non-dormant, non-discharged) relationship with a patient.
func (s *SmartContract) CheckActiveTreatmentRelationship(
	ctx contractapi.TransactionContextInterface,
	doctorID string,
	patientID string,
) (bool, error) {
	err := policy.EnforcePolicy(ctx, "CHECK_TREATMENT_RELATIONSHIP")
	if err != nil {
		return false, err
	}

	// Pure read: dormancy is evaluated, not persisted. This function is
	// invoked via evaluateTransaction, where any PutState is discarded, so
	// the on-chain status only changes through UpdateTreatmentRelationshipStatus.
	// True if ANY relationship for this (doctor, patient) pair is currently
	// active; a PENDING, DORMANT, DISCHARGED or expired one never grants access.
	iter, err := ctx.GetStub().GetStateByPartialCompositeKey(
		trPairIndexObjectType,
		[]string{doctorID, patientID},
	)
	if err != nil {
		return false, err
	}
	defer iter.Close()

	for iter.HasNext() {
		kv, err := iter.Next()
		if err != nil {
			return false, err
		}
		_, parts, err := ctx.GetStub().SplitCompositeKey(kv.Key)
		if err != nil || len(parts) != 3 {
			continue
		}
		if relationshipIsActive(ctx, parts[2]) {
			return true, nil
		}
	}

	// Legacy fallback: relationships created before the per-relationship
	// index only have the single TR_IDX_<doctor>_<patient> entry.
	legacyID, err := ctx.GetStub().GetState(doctorPatientIndexKey(doctorID, patientID))
	if err == nil && legacyID != nil && relationshipIsActive(ctx, string(legacyID)) {
		return true, nil
	}

	return false, nil
}

func (s *SmartContract) UpdateTreatmentRelationshipStatus(
	ctx contractapi.TransactionContextInterface,
	relationshipID string,
	status string,
	updatedAt string,
) error {
	err := policy.EnforcePolicy(ctx, "UPDATE_TREATMENT_RELATIONSHIP")
	if err != nil {
		return err
	}

	switch status {
	case "ACTIVE", "PENDING", "DORMANT", "DISCHARGED":
	default:
		return fmt.Errorf("invalid relationship status %q", status)
	}

	rel, err := s.GetTreatmentRelationship(ctx, relationshipID)
	if err != nil {
		return err
	}

	// DISCHARGED is terminal (re-discharging is idempotent).
	if rel.Status == "DISCHARGED" && status != "DISCHARGED" {
		return fmt.Errorf("cannot change status of a DISCHARGED relationship")
	}

	rel.Status    = status
	rel.UpdatedAt = updatedAt

	relJSON, err := json.Marshal(rel)
	if err != nil {
		return err
	}

	return ctx.GetStub().PutState(treatmentRelationshipKey(relationshipID), relJSON)
}

func (s *SmartContract) ReactivateTreatmentRelationship(
	ctx contractapi.TransactionContextInterface,
	relationshipID string,
	dormantAfter string,
	updatedAt string,
) error {
	err := policy.EnforcePolicy(ctx, "UPDATE_TREATMENT_RELATIONSHIP")
	if err != nil {
		return err
	}

	rel, err := s.GetTreatmentRelationship(ctx, relationshipID)
	if err != nil {
		return err
	}

	if rel.Status == "DISCHARGED" {
		return fmt.Errorf("cannot reactivate a DISCHARGED relationship")
	}

	if _, perr := time.Parse(time.RFC3339, dormantAfter); perr != nil {
		return fmt.Errorf("dormantAfter must be RFC3339: %v", perr)
	}

	rel.Status       = "ACTIVE"
	rel.DormantAfter = dormantAfter
	rel.UpdatedAt    = updatedAt

	relJSON, err := json.Marshal(rel)
	if err != nil {
		return err
	}

	return ctx.GetStub().PutState(treatmentRelationshipKey(relationshipID), relJSON)
}
