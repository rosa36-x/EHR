package policy

var PolicyRegistry = map[string][]string{

	// ── Patient ───────────────────────────────────────────────────────────────
	"CREATE_PATIENT_RECORD": {"HospitalMSP"},
	"UPDATE_PATIENT_RECORD": {"HospitalMSP"},
	"GET_PATIENT_RECORD":    {"HospitalMSP"},

	// ── Consultation ──────────────────────────────────────────────────────────
	"CREATE_CONSULTATION": {"HospitalMSP"},
	"GET_CONSULTATION":    {"HospitalMSP"},
	"UPDATE_CONSULTATION": {"HospitalMSP"},

	// ── Prescription ──────────────────────────────────────────────────────────
	"CREATE_PRESCRIPTION": {"HospitalMSP"},
	"GET_PRESCRIPTION":    {"HospitalMSP", "PharmacyMSP"},
	"UPDATE_PRESCRIPTION": {"HospitalMSP", "PharmacyMSP"},

	// ── Lab Report ────────────────────────────────────────────────────────────
	"CREATE_LAB_REPORT": {"LaboratoryMSP"},
	"GET_LAB_REPORT":    {"HospitalMSP", "LaboratoryMSP"},
	"UPDATE_LAB_REPORT": {"LaboratoryMSP"},

	// ── Referral ──────────────────────────────────────────────────────────────
	"CREATE_REFERRAL": {"HospitalMSP"},
	"GET_REFERRAL":    {"HospitalMSP"},

	// ── Consent ───────────────────────────────────────────────────────────────
	"GRANT_CONSENT":  {"HospitalMSP"},
	"GET_CONSENT":    {"HospitalMSP"},
	"CHECK_CONSENT":  {"HospitalMSP"},
	"REVOKE_CONSENT": {"HospitalMSP"},

	// ── Audit ─────────────────────────────────────────────────────────────────
	"AUDIT_TRANSACTION": {"GovernanceMSP"},
	"GET_AUDIT_LOG":     {"GovernanceMSP", "HospitalMSP"},

	// ── Emergency Access ──────────────────────────────────────────────────────
	"CREATE_EMERGENCY_ACCESS": {"HospitalMSP"},
	"GET_EMERGENCY_ACCESS":    {"HospitalMSP"},

	// ── Permission Request ────────────────────────────────────────────────────
	"CREATE_PERMISSION_REQUEST":  {"HospitalMSP"},
	"GET_PERMISSION_REQUEST":     {"HospitalMSP"},
	"APPROVE_PERMISSION_REQUEST": {"HospitalMSP"},
	"REJECT_PERMISSION_REQUEST":  {"HospitalMSP"},
	"CHECK_PERMISSION":           {"HospitalMSP"},

	// ── Treatment Relationship ────────────────────────────────────────────────
	"CREATE_TREATMENT_RELATIONSHIP": {"HospitalMSP"},
	"GET_TREATMENT_RELATIONSHIP":    {"HospitalMSP"},
	"UPDATE_TREATMENT_RELATIONSHIP": {"HospitalMSP"},
	"CHECK_TREATMENT_RELATIONSHIP":  {"HospitalMSP"},
}
