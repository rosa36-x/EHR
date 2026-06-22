package models

type EmergencyAccess struct {
	EmergencyAccessID string `json:"emergencyAccessID"`
	PatientID         string `json:"patientID"`
	DoctorID          string `json:"doctorID"`
	Reason            string `json:"reason"`
	Status            string `json:"status"`
	Timestamp         string `json:"timestamp"`
}