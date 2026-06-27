package main

import (
	"encoding/json"
	"fmt"

	"github.com/hyperledger/fabric-contract-api-go/contractapi"
	"github.com/rosa36-x/EHR/chaincode/models"
	"github.com/rosa36-x/EHR/chaincode/policy"
)
func (s *SmartContract) CreatePrescription(
	ctx contractapi.TransactionContextInterface,
	prescriptionID string,
	patientID string,
	doctorID string,
	prescriptionCID string,
	prescriptionHash string,
	encryptionKeyRef string,
	status string,
	issuedAt string,
	dispensedAt string,
	createdAt string,
	updatedAt string,
) error {
	err := policy.EnforcePolicy(
		ctx,
		"CREATE_PRESCRIPTION",
	)
	if err != nil {
		return err
	}

	exists, err := assetExistsInCollection(
		ctx,
		PrescriptionCollection,
		"PRE_" + prescriptionID,
	)
	if err != nil {
		return err
	}

	if exists {
		return fmt.Errorf(
			"prescription %s already exists",
			prescriptionID,
		)
	}

	prescription := models.Prescription{
		PrescriptionID:   prescriptionID,
		PatientID:        patientID,
		DoctorID:         doctorID,
		PrescriptionCID:  prescriptionCID,
		PrescriptionHash: prescriptionHash,
		EncryptionKeyRef: encryptionKeyRef,
		Status:           status,
		IssuedAt:         issuedAt,
		DispensedAt:      dispensedAt,
		CreatedAt:        createdAt,
		UpdatedAt:        updatedAt,
	}

	prescriptionJSON, err := json.Marshal(prescription)
	if err != nil {
		return err
	}

	return ctx.GetStub().PutPrivateData(
		PrescriptionCollection,
		"PRE_" + prescriptionID,
		prescriptionJSON,
	)
}
func (s *SmartContract) GetPrescription(
	ctx contractapi.TransactionContextInterface,
	prescriptionID string,
) (*models.Prescription, error) {
	err := policy.EnforcePolicy(
		ctx,
		"GET_PRESCRIPTION",
	)
	if err != nil {
		return nil, err
	}

	prescriptionJSON, err := ctx.GetStub().GetPrivateData(
		PrescriptionCollection,
		"PRE_" + prescriptionID,
	)
	if err != nil {
		return nil, err
	}

	if prescriptionJSON == nil {
		return nil, fmt.Errorf(
			"prescription %s does not exist",
			prescriptionID,
		)
	}

	var prescription models.Prescription

	err = json.Unmarshal(
		prescriptionJSON,
		&prescription,
	)
	if err != nil {
		return nil, err
	}

	return &prescription, nil
}
func (s *SmartContract) UpdatePrescriptionStatus(
	ctx contractapi.TransactionContextInterface,
	prescriptionID string,
	status string,
	dispensedAt string,
	updatedAt string,
) error {
	err := policy.EnforcePolicy(
		ctx,
		"UPDATE_PRESCRIPTION",
	)
	if err != nil {
		return err
	}
	prescription, err := s.GetPrescription(
		ctx,
		prescriptionID,
	)
	if err != nil {
		return err
	}

	prescription.Status = status
	prescription.DispensedAt = dispensedAt
	prescription.UpdatedAt = updatedAt

	prescriptionJSON, err := json.Marshal(prescription)
	if err != nil {
		return err
	}

	return ctx.GetStub().PutPrivateData(
		PrescriptionCollection,
		"PRE_" + prescriptionID,
		prescriptionJSON,
	)
}