package main

import (
	"encoding/json"
	"fmt"
	"time"

	"github.com/hyperledger/fabric-contract-api-go/contractapi"
	"github.com/rosa36-x/EHR/chaincode/models"
	"github.com/rosa36-x/EHR/chaincode/policy"
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

	err := policy.EnforcePolicy(
		ctx,
		"CREATE_EMERGENCY_ACCESS",
	)
	if err != nil {
		return err
	}
	exists, err := ctx.GetStub().GetState("EA_" + emergencyAccessID)
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

	return ctx.GetStub().PutState("EA_" + emergencyAccessID, emergencyJSON)
}
func (s *SmartContract) GetEmergencyAccess(
	ctx contractapi.TransactionContextInterface,
	emergencyAccessID string,
) (*models.EmergencyAccess, error) {

	err := policy.EnforcePolicy(
		ctx,
		"GET_EMERGENCY_ACCESS",
	)
	if err != nil {
		return nil, err
	}
	emergencyJSON, err := ctx.GetStub().GetState("EA_" + emergencyAccessID)
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

// UpdateEmergencyAccessStatus ends an emergency access record. The only
// transitions allowed are ACTIVE -> CLOSED (explicitly closed by the doctor)
// and ACTIVE -> ABORTED (the access could not be fully set up). Both are
// terminal; repeating the same transition is a no-op so a retry is safe.
func (s *SmartContract) UpdateEmergencyAccessStatus(
	ctx contractapi.TransactionContextInterface,
	emergencyAccessID string,
	status string,
	updatedAt string,
) error {

	err := policy.EnforcePolicy(ctx, "UPDATE_EMERGENCY_ACCESS")
	if err != nil {
		return err
	}

	if status != "CLOSED" && status != "ABORTED" {
		return fmt.Errorf("status must be CLOSED or ABORTED, got %q", status)
	}

	if _, perr := time.Parse(time.RFC3339, updatedAt); perr != nil {
		return fmt.Errorf("updatedAt must be RFC3339: %v", perr)
	}

	emergencyJSON, err := ctx.GetStub().GetState("EA_" + emergencyAccessID)
	if err != nil {
		return err
	}
	if emergencyJSON == nil {
		return fmt.Errorf("emergency access %s does not exist", emergencyAccessID)
	}

	var emergency models.EmergencyAccess
	if err := json.Unmarshal(emergencyJSON, &emergency); err != nil {
		return err
	}

	if emergency.Status == status {
		return nil
	}
	if emergency.Status != "ACTIVE" {
		return fmt.Errorf(
			"emergency access %s is already %s and cannot become %s",
			emergencyAccessID, emergency.Status, status,
		)
	}

	emergency.Status = status
	emergency.UpdatedAt = updatedAt

	updatedJSON, err := json.Marshal(emergency)
	if err != nil {
		return err
	}

	return ctx.GetStub().PutState("EA_"+emergencyAccessID, updatedJSON)
}
