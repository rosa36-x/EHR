package models

// Updated Consultation model — adds sensitivityLevel and recordType
type Consultation struct {
	ConsultationID   string `json:"consultationID"`
	PatientID        string `json:"patientID"`
	DoctorID         string `json:"doctorID"`
	Diagnosis        string `json:"diagnosis"`
	RecordType       string `json:"recordType"`       // e.g. PSYCHIATRY, GENERAL, CARDIOLOGY
	SensitivityLevel string `json:"sensitivityLevel"` // SENSITIVE | NORMAL
	ConsultationCID  string `json:"consultationCID"`
	ConsultationHash string `json:"consultationHash"`
	EncryptionKeyRef string `json:"encryptionKeyRef"`
	Timestamp        string `json:"timestamp"`
	CreatedAt        string `json:"createdAt"`
	UpdatedAt        string `json:"updatedAt"`
}

// Updated LabReport model — adds sensitivityLevel and recordType
type LabReport struct {
	ReportID         string `json:"reportID"`
	PatientID        string `json:"patientID"`
	LabTechID        string `json:"labTechID"`
	ReportType       string `json:"reportType"`       // e.g. HIV_TEST, BLOOD_TEST, GENETIC_TEST
	SensitivityLevel string `json:"sensitivityLevel"` // SENSITIVE | NORMAL
	ReportCID        string `json:"reportCID"`
	ReportHash       string `json:"reportHash"`
	EncryptionKeyRef string `json:"encryptionKeyRef"`
	Status           string `json:"status"`
	CreatedAt        string `json:"createdAt"`
	UpdatedAt        string `json:"updatedAt"`
}

// Updated Prescription model — adds sensitivityLevel and recordType
type Prescription struct {
	PrescriptionID   string `json:"prescriptionID"`
	PatientID        string `json:"patientID"`
	DoctorID         string `json:"doctorID"`
	RecordType       string `json:"recordType"`       // e.g. PSYCHIATRIC, GENERAL, CONTROLLED_SUBSTANCE
	SensitivityLevel string `json:"sensitivityLevel"` // SENSITIVE | NORMAL
	PrescriptionCID  string `json:"prescriptionCID"`
	PrescriptionHash string `json:"prescriptionHash"`
	EncryptionKeyRef string `json:"encryptionKeyRef"`
	Status           string `json:"status"`
	IssuedAt         string `json:"issuedAt"`
	DispensedAt      string `json:"dispensedAt"`
	CreatedAt        string `json:"createdAt"`
	UpdatedAt        string `json:"updatedAt"`
}
