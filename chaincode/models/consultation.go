package models
type Consultation struct {
	ConsultationID   string `json:"consultationID"`
	PatientID        string `json:"patientID"`
	DoctorID         string `json:"doctorID"`
	Diagnosis        string `json:"diagnosis"`
	ConsultationCID  string `json:"consultationCID"`
	ConsultationHash string `json:"consultationHash"`
	EncryptionKeyRef string `json:"encryptionKeyRef"`
	Timestamp        string `json:"timestamp"`
	CreatedAt        string `json:"createdAt"`
	UpdatedAt        string `json:"updatedAt"`
}
