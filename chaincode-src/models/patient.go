package models

type Patient struct {
	PatientID    string `json:"patientID"`
	FullName     string `json:"fullName"`
	DOB          string `json:"dob"`
	Gender       string `json:"gender"`
	AadhaarVID   string `json:"aadhaarVID"`
	AadhaarToken string `json:"aadhaarToken"`
	Phone        string `json:"phone"`
	Email        string `json:"email"`
	CreatedAt    string `json:"createdAt"`
	UpdatedAt    string `json:"updatedAt"`
}
