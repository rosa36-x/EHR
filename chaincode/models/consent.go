package models

type Consent struct {
	ConsentID    string `json:"consentID"`
	PatientID    string `json:"patientID"`
	GranteeOrg   string `json:"granteeOrg"`
	ResourceType string `json:"resourceType"`
	Permission   string `json:"permission"`
	Status       string `json:"status"`
	ExpiryDate   string `json:"expiryDate"`
	CreatedAt    string `json:"createdAt"`
	UpdatedAt    string `json:"updatedAt"`
}
