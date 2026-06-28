/**
 * Sensitivity Service
 * Determines whether a record is SENSITIVE or NORMAL
 * based on its recordType.
 *
 * Sensitive record types are fixed per DPDP Act 2023,
 * HIV and AIDS (Prevention and Control) Act 2017,
 * and Indian medical ethics guidelines.
 *
 * Sensitive records require explicit patient permission
 * before a doctor can access them (unless an active
 * treatment relationship exists for that specific condition).
 */

// ── Record Type Taxonomy ──────────────────────────────────────────────────────

export const RecordTypes = {

    // Consultation types
    CONSULTATION: {
        GENERAL:              "GENERAL",
        FOLLOW_UP:            "FOLLOW_UP",
        PSYCHIATRY:           "PSYCHIATRY",           // SENSITIVE
        SUBSTANCE_ABUSE:      "SUBSTANCE_ABUSE",      // SENSITIVE
        REPRODUCTIVE_HEALTH:  "REPRODUCTIVE_HEALTH",  // SENSITIVE
        HIV_AIDS:             "HIV_AIDS",              // SENSITIVE
        GENETIC_COUNSELING:   "GENETIC_COUNSELING",   // SENSITIVE
        DISABILITY:           "DISABILITY",           // SENSITIVE
        TERMINAL_ILLNESS:     "TERMINAL_ILLNESS",     // SENSITIVE
        MINOR:                "MINOR",                // SENSITIVE
        DERMATOLOGY:          "DERMATOLOGY",
        CARDIOLOGY:           "CARDIOLOGY",
        ORTHOPEDICS:          "ORTHOPEDICS",
        NEUROLOGY:            "NEUROLOGY",
        ONCOLOGY:             "ONCOLOGY",             // SENSITIVE (terminal)
        PEDIATRICS:           "PEDIATRICS",           // SENSITIVE (minor)
        GYNECOLOGY:           "GYNECOLOGY",           // SENSITIVE (reproductive)
        ENDOCRINOLOGY:        "ENDOCRINOLOGY",
        PULMONOLOGY:          "PULMONOLOGY",
        GASTROENTEROLOGY:     "GASTROENTEROLOGY",
    },

    // Lab report types
    LAB_REPORT: {
        BLOOD_TEST:           "BLOOD_TEST",
        URINE_TEST:           "URINE_TEST",
        HIV_TEST:             "HIV_TEST",             // SENSITIVE
        STI_TEST:             "STI_TEST",             // SENSITIVE
        GENETIC_TEST:         "GENETIC_TEST",         // SENSITIVE
        DRUG_TEST:            "DRUG_TEST",            // SENSITIVE
        PREGNANCY_TEST:       "PREGNANCY_TEST",       // SENSITIVE
        BIOPSY:               "BIOPSY",
        IMAGING:              "IMAGING",
        PATHOLOGY:            "PATHOLOGY",
        MICROBIOLOGY:         "MICROBIOLOGY",
        TOXICOLOGY:           "TOXICOLOGY",           // SENSITIVE
    },

    // Prescription types
    PRESCRIPTION: {
        GENERAL:              "GENERAL",
        PSYCHIATRIC:          "PSYCHIATRIC",          // SENSITIVE
        CONTROLLED_SUBSTANCE: "CONTROLLED_SUBSTANCE", // SENSITIVE
        REPRODUCTIVE:         "REPRODUCTIVE",         // SENSITIVE
        HIV_MEDICATION:       "HIV_MEDICATION",       // SENSITIVE
        ONCOLOGY:             "ONCOLOGY",
        GENERAL_CHRONIC:      "GENERAL_CHRONIC",
    },

    // Referral types
    REFERRAL: {
        GENERAL:              "GENERAL",
        PSYCHIATRY:           "PSYCHIATRY",           // SENSITIVE
        REPRODUCTIVE_HEALTH:  "REPRODUCTIVE_HEALTH",  // SENSITIVE
        HIV_AIDS:             "HIV_AIDS",             // SENSITIVE
        GENETIC_COUNSELING:   "GENETIC_COUNSELING",   // SENSITIVE
        ONCOLOGY:             "ONCOLOGY",
        SPECIALIST:           "SPECIALIST",
    },
};

// ── Sensitive Type Sets ───────────────────────────────────────────────────────

const SENSITIVE_TYPES = new Set([
    // Consultation
    "PSYCHIATRY",
    "SUBSTANCE_ABUSE",
    "REPRODUCTIVE_HEALTH",
    "HIV_AIDS",
    "GENETIC_COUNSELING",
    "DISABILITY",
    "TERMINAL_ILLNESS",
    "MINOR",
    "ONCOLOGY",
    "PEDIATRICS",
    "GYNECOLOGY",

    // Lab report
    "HIV_TEST",
    "STI_TEST",
    "GENETIC_TEST",
    "DRUG_TEST",
    "PREGNANCY_TEST",
    "TOXICOLOGY",

    // Prescription
    "PSYCHIATRIC",
    "CONTROLLED_SUBSTANCE",
    "REPRODUCTIVE",
    "HIV_MEDICATION",
]);

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Determine if a record type is sensitive.
 *
 * @param {string} recordType - One of the values in RecordTypes
 * @returns {boolean}
 */
export function isSensitive(recordType) {
    return SENSITIVE_TYPES.has(recordType);
}

/**
 * Get sensitivity level string for storage on Fabric.
 *
 * @param {string} recordType
 * @returns {"SENSITIVE" | "NORMAL"}
 */
export function getSensitivityLevel(recordType) {
    return isSensitive(recordType) ? "SENSITIVE" : "NORMAL";
}

/**
 * Validate that a recordType is valid for a given asset category.
 *
 * @param {string} category - "CONSULTATION" | "LAB_REPORT" | "PRESCRIPTION" | "REFERRAL"
 * @param {string} recordType
 * @returns {boolean}
 */
export function isValidRecordType(category, recordType) {
    const types = RecordTypes[category];
    if (!types) return false;
    return Object.values(types).includes(recordType);
}
