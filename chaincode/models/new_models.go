package models

type PermissionRequest struct {
	RequestID     string `json:"requestID"`
	PatientID     string `json:"patientID"`
	DoctorID      string `json:"doctorID"`
	ResourceType  string `json:"resourceType"`
	ResourceID    string `json:"resourceID"`
	Reason        string `json:"reason"`
	Status        string `json:"status"`        // PENDING | APPROVED | REJECTED | EXPIRED
	ExpiresAt     string `json:"expiresAt"`     // 24h patient response window
	AccessExpires string `json:"accessExpires"` // 48h access window after approval
	CreatedAt     string `json:"createdAt"`
	UpdatedAt     string `json:"updatedAt"`
}

type TreatmentRelationship struct {
	RelationshipID   string `json:"relationshipID"`
	PatientID        string `json:"patientID"`
	DoctorID         string `json:"doctorID"`
	RelationshipType string `json:"relationshipType"` // RECENT_APPOINTMENT | FOLLOW_UP_CHECKUP | ONGOING_TREATMENT | REFERRED_BY_DOCTOR | ASSIGNED_EMERGENCY_PHYSICIAN
	Notes            string `json:"notes"`
	Status           string `json:"status"`       // ACTIVE | DORMANT | DISCHARGED
	DormantAfter     string `json:"dormantAfter"` // auto-dormant if no activity after this date
	CreatedAt        string `json:"createdAt"`
	UpdatedAt        string `json:"updatedAt"`
}
