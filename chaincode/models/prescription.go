package models

type Prescription struct {
	PrescriptionID   string `json:"prescriptionID"`
	PatientID        string `json:"patientID"`
	DoctorID         string `json:"doctorID"`
	PrescriptionCID  string `json:"prescriptionCID"`
	PrescriptionHash string `json:"prescriptionHash"`
	EncryptionKeyRef string `json:"encryptionKeyRef"`
	Status           string `json:"status"`
	IssuedAt         string `json:"issuedAt"`
	DispensedAt      string `json:"dispensedAt"`
	CreatedAt        string `json:"createdAt"`
	UpdatedAt        string `json:"updatedAt"`
}
