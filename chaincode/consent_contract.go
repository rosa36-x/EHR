package main

import (
	"encoding/json"
	"fmt"

	"github.com/hyperledger/fabric-contract-api-go/contractapi"
	"github.com/rosa36-x/EHR/chaincode/models"
	"github.com/rosa36-x/EHR/chaincode/policy"
)

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

	err := policy.EnforcePolicy(
		ctx,
		"GRANT_CONSENT",
	)
	if err != nil {
		return err
	}
	exists, err := assetExistsInCollection(
		ctx,
		ConsentCollection,
		"CON_" + consentID,
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
		"CON_" + consentID,
		consentJSON,
	)
}
func (s *SmartContract) GetConsent(
	ctx contractapi.TransactionContextInterface,
	consentID string,
) (*models.Consent, error) {
	err := policy.EnforcePolicy(
		ctx,
		"GET_CONSENT",
	)
	if err != nil {
		return nil, err
	}

	consentJSON, err := ctx.GetStub().GetPrivateData(
		ConsentCollection,
		"CON_" + consentID,
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
	err := policy.EnforcePolicy(
		ctx,
		"CHECK_CONSENT",
	)
	if err != nil {
		return false, err
	}

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
	err := policy.EnforcePolicy(
		ctx,
		"REVOKE_CONSENT",
	)
	if err != nil {
		return err
	}


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
		"CON_" + consentID,
		consentJSON,
	)
}
