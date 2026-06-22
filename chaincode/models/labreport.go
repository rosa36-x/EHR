package models

type LabReport struct {
	ReportID         string `json:"reportID"`
	PatientID        string `json:"patientID"`
	LabTechID        string `json:"labTechID"`
	ReportType       string `json:"reportType"`
	ReportCID        string `json:"reportCID"`
	ReportHash       string `json:"reportHash"`
	EncryptionKeyRef string `json:"encryptionKeyRef"`
	Status           string `json:"status"`
	CreatedAt        string `json:"createdAt"`
	UpdatedAt        string `json:"updatedAt"`
}