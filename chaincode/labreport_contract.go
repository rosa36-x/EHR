package main

import (
	"encoding/json"
	"fmt"

	"github.com/hyperledger/fabric-contract-api-go/contractapi"
	"github.com/rosa36-x/EHR/chaincode/models"
	"github.com/rosa36-x/EHR/chaincode/policy"
)
func (s *SmartContract) CreateLabReport(
	ctx contractapi.TransactionContextInterface,
	reportID string,
	patientID string,
	labTechID string,
	reportType string,
	reportCID string,
	reportHash string,
	encryptionKeyRef string,
	status string,
	createdAt string,
	updatedAt string,
) error {
	err := policy.EnforcePolicy(
		ctx,
		"CREATE_LAB_REPORT",
	)
	if err != nil {
		return err
	}

	exists, err := assetExistsInCollection(
		ctx,
		LabReportCollection,
		reportID,
	)
	if err != nil {
		return err
	}

	if exists {
		return fmt.Errorf(
			"lab report %s already exists",
			reportID,
		)
	}

	report := models.LabReport{
		ReportID:         reportID,
		PatientID:        patientID,
		LabTechID:        labTechID,
		ReportType:       reportType,
		ReportCID:        reportCID,
		ReportHash:       reportHash,
		EncryptionKeyRef: encryptionKeyRef,
		Status:           status,
		CreatedAt:        createdAt,
		UpdatedAt:        updatedAt,
	}

	reportJSON, err := json.Marshal(report)
	if err != nil {
		return err
	}

	return ctx.GetStub().PutPrivateData(
		LabReportCollection,
		reportID,
		reportJSON,
	)
}
func (s *SmartContract) GetLabReport(
	ctx contractapi.TransactionContextInterface,
	reportID string,
) (*models.LabReport, error) {
	err := policy.EnforcePolicy(
		ctx,
		"GET_LAB_REPORT",
	)
	if err != nil {
		return nil, err
	}

	reportJSON, err := ctx.GetStub().GetPrivateData(
		LabReportCollection,
		reportID,
	)
	if err != nil {
		return nil, err
	}

	if reportJSON == nil {
		return nil, fmt.Errorf(
			"lab report %s does not exist",
			reportID,
		)
	}

	var report models.LabReport

	err = json.Unmarshal(
		reportJSON,
		&report,
	)
	if err != nil {
		return nil, err
	}

	return &report, nil
}
func (s *SmartContract) UpdateLabReport(
	ctx contractapi.TransactionContextInterface,
	reportID string,
	reportType string,
	reportCID string,
	reportHash string,
	encryptionKeyRef string,
	status string,
	updatedAt string,
) error {
	err := policy.EnforcePolicy(
		ctx,
		"UPDATE_LAB_REPORT",	
	)
	if err != nil {
		return err
	}

	report, err := s.GetLabReport(
		ctx,
		reportID,
	)
	if err != nil {
		return err
	}

	report.ReportType = reportType
	report.ReportCID = reportCID
	report.ReportHash = reportHash
	report.EncryptionKeyRef = encryptionKeyRef
	report.Status = status
	report.UpdatedAt = updatedAt

	reportJSON, err := json.Marshal(report)
	if err != nil {
		return err
	}

	return ctx.GetStub().PutPrivateData(
		LabReportCollection,
		reportID,
		reportJSON,
	)
}
