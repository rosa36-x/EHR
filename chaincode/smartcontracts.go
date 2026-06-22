package main

import (
	"encoding/json"
	"fmt"
	"github.com/hyperledger/fabric-contract-api-go/contractapi"
	"github.com/rosa36-x/EHR/chaincode/models"
)

type SmartContract struct {
	contractapi.Contract
}
const (
	PatientCollection      = "PatientRecordCollection"
	ConsentCollection      = "ConsentCollection"
	PrescriptionCollection = "PrescriptionCollection"
	LabReportCollection    = "LabReportCollection"
)
func assetExistsInCollection(
	ctx contractapi.TransactionContextInterface,
	collection string,
	key string,
) (bool, error) {

	data, err := ctx.GetStub().GetPrivateData(collection, key)
	if err != nil {
		return false, err
	}

	return data != nil, nil
}
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
