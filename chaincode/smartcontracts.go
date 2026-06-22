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
func (s *SmartContract) GrantConsent(
	ctx contractapi.TransactionContextInterface,
	consentID string,
	patientID string,
	granteeOrg string,
	resourceType string,
	permission string,
	status string,
	expiryDate string,
	createdAt string,
	updatedAt string,
) error {

	exists, err := assetExistsInCollection(
		ctx,
		ConsentCollection,
		consentID,
	)
	if err != nil {
		return err
	}

	if exists {
		return fmt.Errorf("consent %s already exists", consentID)
	}

	consent := models.Consent{
		ConsentID:    consentID,
		PatientID:    patientID,
		GranteeOrg:   granteeOrg,
		ResourceType: resourceType,
		Permission:   permission,
		Status:       status,
		ExpiryDate:   expiryDate,
		CreatedAt:    createdAt,
		UpdatedAt:    updatedAt,
	}

	consentJSON, err := json.Marshal(consent)
	if err != nil {
		return err
	}

	return ctx.GetStub().PutPrivateData(
		ConsentCollection,
		consentID,
		consentJSON,
	)
}
func (s *SmartContract) GetConsent(
	ctx contractapi.TransactionContextInterface,
	consentID string,
) (*models.Consent, error) {

	consentJSON, err := ctx.GetStub().GetPrivateData(
		ConsentCollection,
		consentID,
	)
	if err != nil {
		return nil, err
	}

	if consentJSON == nil {
		return nil, fmt.Errorf("consent %s does not exist", consentID)
	}

	var consent models.Consent

	err = json.Unmarshal(consentJSON, &consent)
	if err != nil {
		return nil, err
	}

	return &consent, nil
}
func (s *SmartContract) CheckConsent(
	ctx contractapi.TransactionContextInterface,
	consentID string,
) (bool, error) {

	consent, err := s.GetConsent(ctx, consentID)
	if err != nil {
		return false, err
	}

	if consent.Status != "ACTIVE" {
		return false, nil
	}

	return true, nil
}
func (s *SmartContract) RevokeConsent(
	ctx contractapi.TransactionContextInterface,
	consentID string,
	updatedAt string,
) error {

	consent, err := s.GetConsent(ctx, consentID)
	if err != nil {
		return err
	}

	consent.Status = "REVOKED"
	consent.UpdatedAt = updatedAt

	consentJSON, err := json.Marshal(consent)
	if err != nil {
		return err
	}

	return ctx.GetStub().PutPrivateData(
		ConsentCollection,
		consentID,
		consentJSON,
	)
}
