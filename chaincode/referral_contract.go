package main

import (
	"encoding/json"
	"fmt"

	"github.com/hyperledger/fabric-contract-api-go/contractapi"
	"github.com/rosa36-x/EHR/chaincode/models"
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

	exists, err := ctx.GetStub().GetState(referralID)
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

	return ctx.GetStub().PutState(referralID, referralJSON)
}
