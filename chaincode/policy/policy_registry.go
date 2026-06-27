package policy

// PolicyRegistry maps transaction types to authorized MSPs.
//
// EnforcePolicy uses OR semantics — the caller's MSP must match
// ANY ONE entry in the list. Entries here reflect who is permitted
// to invoke that transaction type from the application layer.
//
// For write operations that require multi-org endorsement, that is
// enforced by the collection endorsement policy in collections_config.json,
// NOT here. This registry controls identity-level access only.
var PolicyRegistry = map[string][]string{

	// ── Patient ───────────────────────────────────────────────────────────────
	// Only hospital staff create and update patient records
	"CREATE_PATIENT_RECORD": {
		"HospitalMSP",
	},
	"UPDATE_PATIENT_RECORD": {
		"HospitalMSP",
	},
	"GET_PATIENT_RECORD": {
		"HospitalMSP",
	},

	// ── Consultation ──────────────────────────────────────────────────────────
	"CREATE_CONSULTATION": {
		"HospitalMSP",
	},
	"GET_CONSULTATION": {
		"HospitalMSP",
	},
	"UPDATE_CONSULTATION": {
		"HospitalMSP",
	},

	// ── Prescription ──────────────────────────────────────────────────────────
	// Hospital issues; pharmacy reads and updates on dispense
	"CREATE_PRESCRIPTION": {
		"HospitalMSP",
	},
	"GET_PRESCRIPTION": {
		"HospitalMSP",
		"PharmacyMSP",
	},
	"UPDATE_PRESCRIPTION": {
		"HospitalMSP",
		"PharmacyMSP",
	},

	// ── Lab Report ────────────────────────────────────────────────────────────
	// Lab creates and updates; hospital reads results
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

	// ── Referral ──────────────────────────────────────────────────────────────
	"CREATE_REFERRAL": {
		"HospitalMSP",
	},
	"GET_REFERRAL": {
		"HospitalMSP",
	},

	// ── Consent ───────────────────────────────────────────────────────────────
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

	// ── Audit ─────────────────────────────────────────────────────────────────
	// Governance writes and reads audit logs
	"AUDIT_TRANSACTION": {
		"GovernanceMSP",
	},
	"GET_AUDIT_LOG": {
		"GovernanceMSP",
	},

	// ── Emergency Access ──────────────────────────────────────────────────────
	"CREATE_EMERGENCY_ACCESS": {
		"HospitalMSP",
	},
	"GET_EMERGENCY_ACCESS": {
		"HospitalMSP",
	},
}
