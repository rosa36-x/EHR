package policy

// PolicyRegistry maps transaction types to required MSPs
var PolicyRegistry = map[string][]string{

	// Tier 1: Clinical truth
	"CREATE_PATIENT_RECORD": {
		"HospitalMSP",
		"LaboratoryMSP",
	},

	"UPDATE_PATIENT_RECORD": {
		"HospitalMSP",
		"LaboratoryMSP",
	},

	// Optional read policy
	"GET_PATIENT_RECORD": {
		"HospitalMSP",
	},

	// Tier 2: Prescription flow
	"CREATE_PRESCRIPTION": {
		"HospitalMSP",
		"PharmacyMSP",
	},

	// Tier 3: Compliance-heavy
	"AUDIT_TRANSACTION": {
		"HospitalMSP",
		"LaboratoryMSP",
		"GovernanceMSP",
	},
	"GET_AUDIT_LOG": {
		"GovernanceMSP",
	},
	"CREATE_REFERRAL": {
		"HospitalMSP",
	},

	"GET_REFERRAL": {
		"HospitalMSP",
	},
	"GET_PRESCRIPTION": {
		"HospitalMSP",
	},

	"UPDATE_PRESCRIPTION": {
		"HospitalMSP",
		"PharmacyMSP",
	},
	"CREATE_LAB_REPORT": {
		"LaboratoryMSP",
	},

	"GET_LAB_REPORT": {
		"HospitalMSP",
		"LaboratoryMSP",
	},

	"UPDATE_LAB_REPORT": {
		"LaboratoryMSP",
	},
	"CREATE_EMERGENCY_ACCESS": {
		"HospitalMSP",
	},

	"GET_EMERGENCY_ACCESS": {
		"HospitalMSP",
	},
	"CREATE_CONSULTATION": {
		"HospitalMSP",
	},

	"GET_CONSULTATION": {
		"HospitalMSP",
	},
	
	"UPDATE_CONSULTATION": {
		"HospitalMSP",
	},
	"GRANT_CONSENT": {
		"HospitalMSP",
	},

	"GET_CONSENT": {
		"HospitalMSP",
	},

	"CHECK_CONSENT": {
		"HospitalMSP",
	},

	"REVOKE_CONSENT": {
		"HospitalMSP",
	},
}