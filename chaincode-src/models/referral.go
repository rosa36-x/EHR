package models

type Referral struct {
	ReferralID       string `json:"referralID"`
	PatientID        string `json:"patientID"`
	FromDoctorID     string `json:"fromDoctorID"`
	ToDoctorID       string `json:"toDoctorID"`
	ReferralCID      string `json:"referralCID"`
	ReferralHash     string `json:"referralHash"`
	EncryptionKeyRef string `json:"encryptionKeyRef"`
	ReferralReason   string `json:"referralReason"`
	CreatedAt        string `json:"createdAt"`
	UpdatedAt        string `json:"updatedAt"`
}
