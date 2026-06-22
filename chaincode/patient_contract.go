package main

import (
	"encoding/json"
	"fmt"

	"github.com/hyperledger/fabric-contract-api-go/contractapi"
	"github.com/rosa36-x/EHR/chaincode/models"
)
func (s *SmartContract) CreatePatient(
	ctx contractapi.TransactionContextInterface,
	patientID string,
	fullName string,
	dob string,
	gender string,
	aadhaarVID string,
	aadhaarToken string,
	phone string,
	email string,
	createdAt string,
	updatedAt string,
) error {

	patient := models.Patient{
		PatientID:    patientID,
		FullName:     fullName,
		DOB:          dob,
		Gender:       gender,
		AadhaarVID:   aadhaarVID,
		AadhaarToken: aadhaarToken,
		Phone:        phone,
		Email:        email,
		CreatedAt:    createdAt,
		UpdatedAt:    updatedAt,
	}

	
	exists, err := assetExistsInCollection(ctx,PatientCollection,patientID,
	)
	if err != nil {
		return err
	}

	if exists {
		return fmt.Errorf("patient %s already exists", patientID)
	}

	patientJSON, err := json.Marshal(patient)
	if err != nil {
		return err
	}

	err = ctx.GetStub().PutPrivateData(
		PatientCollection,
		patientID,
		patientJSON,
	)
	if err != nil {
		return err
	}

	return nil
}
func (s *SmartContract) GetPatient(
	ctx contractapi.TransactionContextInterface,
	patientID string,
) (*models.Patient, error) {

	patientJSON, err := ctx.GetStub().GetPrivateData(
		PatientCollection,
		patientID,
	)
	if err != nil {
		return nil, err
	}

	if patientJSON == nil {
		return nil, fmt.Errorf("patient %s does not exist", patientID)
	}

	var patient models.Patient

	err = json.Unmarshal(patientJSON, &patient)
	if err != nil {
		return nil, err
	}

	return &patient, nil
}
func (s *SmartContract) UpdatePatient(
	ctx contractapi.TransactionContextInterface,
	patientID string,
	fullName string,
	dob string,
	gender string,
	phone string,
	email string,
	updatedAt string,
) error {

	patient, err := s.GetPatient(ctx, patientID)
	if err != nil {
		return err
	}

	patient.FullName = fullName
	patient.DOB = dob
	patient.Gender = gender
	patient.Phone = phone
	patient.Email = email
	patient.UpdatedAt = updatedAt

	patientJSON, err := json.Marshal(patient)
	if err != nil {
		return err
	}

	return ctx.GetStub().PutPrivateData(
		PatientCollection,
		patientID,
		patientJSON,
	)
}
