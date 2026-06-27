package main

import (
	"encoding/json"
	"fmt"

	"github.com/hyperledger/fabric-contract-api-go/contractapi"
	"github.com/rosa36-x/EHR/chaincode/models"
	"github.com/rosa36-x/EHR/chaincode/policy"
)

// consultationKey namespaces consultation IDs inside PatientRecordCollection
// to prevent key collisions with patient records (PAT prefix).
// Consultations use prefix CONS_ e.g. CONS_CONS0001
func consultationKey(consultationID string) string {
	return "CONS_" + consultationID
}

func (s *SmartContract) CreateConsultation(
	ctx contractapi.TransactionContextInterface,
	consultationID string,
	patientID string,
	doctorID string,
	diagnosis string,
	consultationCID string,
	consultationHash string,
	encryptionKeyRef string,
	timestamp string,
	createdAt string,
	updatedAt string,
) error {

	err := policy.EnforcePolicy(
		ctx,
		"CREATE_CONSULTATION",
	)
	if err != nil {
		return err
	}

	key := consultationKey(consultationID)

	exists, err := assetExistsInCollection(
		ctx,
		PatientCollection,
		key,
	)
	if err != nil {
		return err
	}

	if exists {
		return fmt.Errorf("consultation %s already exists", consultationID)
	}

	consultation := models.Consultation{
		ConsultationID:   consultationID,
		PatientID:        patientID,
		DoctorID:         doctorID,
		Diagnosis:        diagnosis,
		ConsultationCID:  consultationCID,
		ConsultationHash: consultationHash,
		EncryptionKeyRef: encryptionKeyRef,
		Timestamp:        timestamp,
		CreatedAt:        createdAt,
		UpdatedAt:        updatedAt,
	}

	consultationJSON, err := json.Marshal(consultation)
	if err != nil {
		return err
	}

	return ctx.GetStub().PutPrivateData(
		PatientCollection,
		key,
		consultationJSON,
	)
}

func (s *SmartContract) GetConsultation(
	ctx contractapi.TransactionContextInterface,
	consultationID string,
) (*models.Consultation, error) {
	err := policy.EnforcePolicy(
		ctx,
		"GET_CONSULTATION",
	)
	if err != nil {
		return nil, err
	}

	key := consultationKey(consultationID)

	consultationJSON, err := ctx.GetStub().GetPrivateData(
		PatientCollection,
		key,
	)
	if err != nil {
		return nil, err
	}

	if consultationJSON == nil {
		return nil, fmt.Errorf(
			"consultation %s does not exist",
			consultationID,
		)
	}

	var consultation models.Consultation

	err = json.Unmarshal(
		consultationJSON,
		&consultation,
	)
	if err != nil {
		return nil, err
	}

	return &consultation, nil
}

func (s *SmartContract) UpdateConsultation(
	ctx contractapi.TransactionContextInterface,
	consultationID string,
	diagnosis string,
	consultationCID string,
	consultationHash string,
	encryptionKeyRef string,
	updatedAt string,
) error {
	err := policy.EnforcePolicy(
		ctx,
		"UPDATE_CONSULTATION",
	)
	if err != nil {
		return err
	}

	consultation, err := s.GetConsultation(
		ctx,
		consultationID,
	)
	if err != nil {
		return err
	}

	consultation.Diagnosis = diagnosis
	consultation.ConsultationCID = consultationCID
	consultation.ConsultationHash = consultationHash
	consultation.EncryptionKeyRef = encryptionKeyRef
	consultation.UpdatedAt = updatedAt

	consultationJSON, err := json.Marshal(consultation)
	if err != nil {
		return err
	}

	// Write back using the same prefixed key
	key := consultationKey(consultationID)

	return ctx.GetStub().PutPrivateData(
		PatientCollection,
		key,
		consultationJSON,
	)
}
