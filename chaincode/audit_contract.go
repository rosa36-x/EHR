package main

import (
	"encoding/json"
	"fmt"

	"github.com/hyperledger/fabric-contract-api-go/contractapi"
	"github.com/rosa36-x/EHR/chaincode/models"
)
func (s *SmartContract) CreateAuditLog(
	ctx contractapi.TransactionContextInterface,
	auditID string,
	actorID string,
	actorRole string,
	action string,
	resourceType string,
	resourceID string,
	timestamp string,
) error {

	exists, err := ctx.GetStub().GetState(auditID)
	if err != nil {
		return err
	}

	if exists != nil {
		return fmt.Errorf("audit log %s already exists", auditID)
	}

	audit := models.AuditLog{
		AuditID:      auditID,
		ActorID:      actorID,
		ActorRole:    actorRole,
		Action:       action,
		ResourceType: resourceType,
		ResourceID:   resourceID,
		Timestamp:    timestamp,
	}

	auditJSON, err := json.Marshal(audit)
	if err != nil {
		return err
	}

	return ctx.GetStub().PutState(auditID, auditJSON)
}
func (s *SmartContract) GetAuditLog(
	ctx contractapi.TransactionContextInterface,
	auditID string,
) (*models.AuditLog, error) {

	auditJSON, err := ctx.GetStub().GetState(auditID)
	if err != nil {
		return nil, err
	}

	if auditJSON == nil {
		return nil, fmt.Errorf("audit log %s does not exist", auditID)
	}

	var audit models.AuditLog

	err = json.Unmarshal(auditJSON, &audit)
	if err != nil {
		return nil, err
	}

	return &audit, nil
}