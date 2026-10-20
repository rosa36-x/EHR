package main

import (
	"encoding/json"
	"fmt"
	"time"

	"github.com/hyperledger/fabric-contract-api-go/contractapi"
	"github.com/rosa36-x/EHR/chaincode/models"
	"github.com/rosa36-x/EHR/chaincode/policy"
)

func permissionRequestKey(requestID string) string {
	return "PREQ_" + requestID
}

// doctorResourceKey creates a composite key for checking active permissions
// by doctorID + resourceID — used in CheckActivePermission
func (s *SmartContract) doctorResourceIndex(
	ctx contractapi.TransactionContextInterface,
	doctorID string,
	resourceID string,
) string {
	return fmt.Sprintf("PREQ_IDX_%s_%s", doctorID, resourceID)
}

func (s *SmartContract) CreatePermissionRequest(
	ctx contractapi.TransactionContextInterface,
	requestID string,
	patientID string,
	doctorID string,
	resourceType string,
	resourceID string,
	reason string,
	status string,
	expiresAt string,
	createdAt string,
	updatedAt string,
) error {
	err := policy.EnforcePolicy(ctx, "CREATE_PERMISSION_REQUEST")
	if err != nil {
		return err
	}

	key := permissionRequestKey(requestID)

	exists, err := ctx.GetStub().GetState(key)
	if err != nil {
		return err
	}
	if exists != nil {
		return fmt.Errorf("permission request %s already exists", requestID)
	}

	req := models.PermissionRequest{
		RequestID:    requestID,
		PatientID:    patientID,
		DoctorID:     doctorID,
		ResourceType: resourceType,
		ResourceID:   resourceID,
		Reason:       reason,
		Status:       status,
		ExpiresAt:    expiresAt,
		AccessExpires: "",
		CreatedAt:    createdAt,
		UpdatedAt:    updatedAt,
	}

	reqJSON, err := json.Marshal(req)
	if err != nil {
		return err
	}

	return ctx.GetStub().PutState(key, reqJSON)
}

func (s *SmartContract) GetPermissionRequest(
	ctx contractapi.TransactionContextInterface,
	requestID string,
) (*models.PermissionRequest, error) {
	err := policy.EnforcePolicy(ctx, "GET_PERMISSION_REQUEST")
	if err != nil {
		return nil, err
	}

	key := permissionRequestKey(requestID)

	reqJSON, err := ctx.GetStub().GetState(key)
	if err != nil {
		return nil, err
	}
	if reqJSON == nil {
		return nil, fmt.Errorf("permission request %s does not exist", requestID)
	}

	var req models.PermissionRequest
	err = json.Unmarshal(reqJSON, &req)
	if err != nil {
		return nil, err
	}

	return &req, nil
}

func (s *SmartContract) ApprovePermissionRequest(
	ctx contractapi.TransactionContextInterface,
	requestID string,
	status string,
	accessExpires string,
	updatedAt string,
) error {
	err := policy.EnforcePolicy(ctx, "APPROVE_PERMISSION_REQUEST")
	if err != nil {
		return err
	}

	req, err := s.GetPermissionRequest(ctx, requestID)
	if err != nil {
		return err
	}

	if req.Status != "PENDING" {
		return fmt.Errorf("permission request %s is not in PENDING state", requestID)
	}

	// Check request hasn't expired
	expiry, err := time.Parse(time.RFC3339, req.ExpiresAt)
	if err != nil {
		return fmt.Errorf("invalid expiry format: %s", req.ExpiresAt)
	}
	if time.Now().After(expiry) {
		req.Status = "EXPIRED"
		reqJSON, _ := json.Marshal(req)
		ctx.GetStub().PutState(permissionRequestKey(requestID), reqJSON)
		return fmt.Errorf("permission request %s has expired", requestID)
	}

	req.Status        = "APPROVED"
	req.AccessExpires = accessExpires
	req.UpdatedAt     = updatedAt

	reqJSON, err := json.Marshal(req)
	if err != nil {
		return err
	}

	// Write index for fast CheckActivePermission lookups
	indexKey := s.doctorResourceIndex(ctx, req.DoctorID, req.ResourceID)
	ctx.GetStub().PutState(indexKey, []byte(requestID))

	return ctx.GetStub().PutState(permissionRequestKey(requestID), reqJSON)
}

func (s *SmartContract) RejectPermissionRequest(
	ctx contractapi.TransactionContextInterface,
	requestID string,
	status string,
	updatedAt string,
) error {
	err := policy.EnforcePolicy(ctx, "REJECT_PERMISSION_REQUEST")
	if err != nil {
		return err
	}

	req, err := s.GetPermissionRequest(ctx, requestID)
	if err != nil {
		return err
	}

	if req.Status != "PENDING" {
		return fmt.Errorf("permission request %s is not in PENDING state", requestID)
	}

	req.Status    = "REJECTED"
	req.UpdatedAt = updatedAt

	reqJSON, err := json.Marshal(req)
	if err != nil {
		return err
	}

	return ctx.GetStub().PutState(permissionRequestKey(requestID), reqJSON)
}

// CheckActivePermission checks if a doctor has an approved,
// non-expired permission for a specific resource.
func (s *SmartContract) CheckActivePermission(
	ctx contractapi.TransactionContextInterface,
	doctorID string,
	resourceID string,
) (bool, error) {
	err := policy.EnforcePolicy(ctx, "CHECK_PERMISSION")
	if err != nil {
		return false, err
	}

	indexKey   := s.doctorResourceIndex(ctx, doctorID, resourceID)
	requestIDBytes, err := ctx.GetStub().GetState(indexKey)
	if err != nil || requestIDBytes == nil {
		return false, nil
	}

	req, err := s.GetPermissionRequest(ctx, string(requestIDBytes))
	if err != nil || req == nil {
		return false, nil
	}

	if req.Status != "APPROVED" {
		return false, nil
	}

	// Check 48-hour access window
	accessExpiry, err := time.Parse(time.RFC3339, req.AccessExpires)
	if err != nil {
		return false, nil
	}

	return time.Now().Before(accessExpiry), nil
}
