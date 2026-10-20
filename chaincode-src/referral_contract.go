package main

import (
	"encoding/json"
	"fmt"

	"github.com/hyperledger/fabric-contract-api-go/contractapi"
	"github.com/rosa36-x/EHR/chaincode/models"
	"github.com/rosa36-x/EHR/chaincode/policy"
)
func (s *SmartContract) CreateReferral(
	ctx contractapi.TransactionContextInterface,
	referralID string,
	patientID string,
	fromDoctorID string,
	toDoctorID string,
	referralCID string,
	referralHash string,
	encryptionKeyRef string,
	referralReason string,
	createdAt string,
	updatedAt string,
) error {

	err := policy.EnforcePolicy(
		ctx,
		"CREATE_REFERRAL",
	)
	if err != nil {
		return err
	}
	exists, err := ctx.GetStub().GetState("REF_" + referralID)
	if err != nil {
		return err
	}

	if exists != nil {
		return fmt.Errorf("referral %s already exists", referralID)
	}

	referral := models.Referral{
		ReferralID:       referralID,
		PatientID:        patientID,
		FromDoctorID:     fromDoctorID,
		ToDoctorID:       toDoctorID,
		ReferralCID:      referralCID,
		ReferralHash:     referralHash,
		EncryptionKeyRef: encryptionKeyRef,
		ReferralReason:   referralReason,
		CreatedAt:        createdAt,
		UpdatedAt:        updatedAt,
	}

	referralJSON, err := json.Marshal(referral)
	if err != nil {
		return err
	}

	return ctx.GetStub().PutState("REF_" + referralID, referralJSON)
}

func (s *SmartContract) GetReferral(
	ctx contractapi.TransactionContextInterface,
	referralID string,
) (*models.Referral, error) {

	err := policy.EnforcePolicy(
		ctx,
		"GET_REFERRAL",
	)
	if err != nil {
		return nil, err
	}
	referralJSON, err := ctx.GetStub().GetState("REF_" + referralID)
	if err != nil {
		return nil, err
	}

	if referralJSON == nil {
		return nil, fmt.Errorf("referral %s does not exist", referralID)
	}

	var referral models.Referral

	err = json.Unmarshal(referralJSON, &referral)
	if err != nil {
		return nil, err
	}

	return &referral, nil
}