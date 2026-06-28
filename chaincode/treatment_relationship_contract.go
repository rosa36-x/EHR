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

	// Write index for fast doctor-patient lookup
	idxKey := doctorPatientIndexKey(doctorID, patientID)
	ctx.GetStub().PutState(idxKey, []byte(relationshipID))

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

	idxKey := doctorPatientIndexKey(doctorID, patientID)
	relIDBytes, err := ctx.GetStub().GetState(idxKey)
	if err != nil || relIDBytes == nil {
		return false, nil
	}

	rel, err := s.GetTreatmentRelationship(ctx, string(relIDBytes))
	if err != nil || rel == nil {
		return false, nil
	}

	if rel.Status == "DISCHARGED" {
		return false, nil
	}

	// Auto-detect dormancy
	dormant, err := time.Parse(time.RFC3339, rel.DormantAfter)
	if err == nil && time.Now().After(dormant) {
		// Auto-mark dormant on-chain
		rel.Status    = "DORMANT"
		rel.UpdatedAt = time.Now().Format(time.RFC3339)
		relJSON, _   := json.Marshal(rel)
		ctx.GetStub().PutState(treatmentRelationshipKey(rel.RelationshipID), relJSON)
		return false, nil
	}

	return rel.Status == "ACTIVE", nil
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

	rel, err := s.GetTreatmentRelationship(ctx, relationshipID)
	if err != nil {
		return err
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

	rel.Status       = "ACTIVE"
	rel.DormantAfter = dormantAfter
	rel.UpdatedAt    = updatedAt

	relJSON, err := json.Marshal(rel)
	if err != nil {
		return err
	}

	return ctx.GetStub().PutState(treatmentRelationshipKey(relationshipID), relJSON)
}
