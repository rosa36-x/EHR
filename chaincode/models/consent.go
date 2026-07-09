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

// ConsentFlag is a deliberately minimal mirror of a Consent, written into a
// per-grantee-org private collection (e.g. PharmacyConsentFlagCollection) so
// that org's own peers can answer "is this still active?" without ever being
// given membership on ConsentCollection itself. It carries none of Consent's
// other fields (Permission, ConsentID, CreatedAt...) — only what
// HasActiveConsent needs to decide access, and nothing about other patients'
// or other orgs' consents ever lands in a collection this org belongs to.
type ConsentFlag struct {
	Status     string `json:"status"`
	ExpiryDate string `json:"expiryDate"`
}
