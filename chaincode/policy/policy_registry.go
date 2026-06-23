package policy

// PolicyRegistry maps transaction types to required MSPs
var PolicyRegistry = map[string][]string{

	//Tier 1: Clinical truth
	"CREATE_PATIENT_RECORD": {
		"HospitalMSP",
		"LaboratoryMSP",
	},

	"UPDATE_PATIENT_RECORD": {
		"HospitalMSP",
		"LaboratoryMSP",
	},

	//Tier 2: Prescription flow (will evolve later)
	"CREATE_PRESCRIPTION": {
		"HospitalMSP",
		"PharmacyMSP",
	},

	//Tier 3: Compliance-heavy
	"AUDIT_TRANSACTION": {
		"HospitalMSP",
		"LaboratoryMSP",
		"GovernanceMSP",
	},
}
