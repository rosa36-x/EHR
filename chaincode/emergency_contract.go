package main

import (
	"encoding/json"
	"fmt"

	"github.com/hyperledger/fabric-contract-api-go/contractapi"
	"github.com/rosa36-x/EHR/chaincode/models"
)
func (s *SmartContract) CreateEmergencyAccess(
	ctx contractapi.TransactionContextInterface,
	emergencyAccessID string,
	patientID string,
	doctorID string,
	reason string,
	status string,
	timestamp string,
) error {

	exists, err := ctx.GetStub().GetState(emergencyAccessID)
	if err != nil {
		return err
	}

	if exists != nil {
		return fmt.Errorf("emergency access %s already exists", emergencyAccessID)
	}

	emergency := models.EmergencyAccess{
		EmergencyAccessID: emergencyAccessID,
		PatientID:         patientID,
		DoctorID:          doctorID,
		Reason:            reason,
		Status:            status,
		Timestamp:         timestamp,
	}

	emergencyJSON, err := json.Marshal(emergency)
	if err != nil {
		return err
	}

	return ctx.GetStub().PutState(emergencyAccessID, emergencyJSON)
}
func (s *SmartContract) GetEmergencyAccess(
	ctx contractapi.TransactionContextInterface,
	emergencyAccessID string,
) (*models.EmergencyAccess, error) {

	emergencyJSON, err := ctx.GetStub().GetState(emergencyAccessID)
	if err != nil {
		return nil, err
	}

	if emergencyJSON == nil {
		return nil, fmt.Errorf("emergency access %s does not exist", emergencyAccessID)
	}

	var emergency models.EmergencyAccess

	err = json.Unmarshal(emergencyJSON, &emergency)
	if err != nil {
		return nil, err
	}

	return &emergency, nil
}