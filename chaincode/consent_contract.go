package main

import (
	"encoding/json"
	"fmt"
	"time"

	"github.com/hyperledger/fabric-contract-api-go/contractapi"
	"github.com/rosa36-x/EHR/chaincode/models"
	"github.com/rosa36-x/EHR/chaincode/policy"
)

// consentFlagCollectionForOrg maps a grantee org to its dedicated flag
// collection — the only private data that org's peers ever receive about
// consent, and only for grants actually made to them. Add a line here (and
// a matching collection in collections_config.json) to onboard another org;
// an org with no entry here just never gets a HasActiveConsent path, same
// as if no consent existed.
func consentFlagCollectionForOrg(granteeOrg string) (string, bool) {
	switch granteeOrg {
	case "PharmacyMSP":
		return "PharmacyConsentFlagCollection", true
	case "LaboratoryMSP":
		return "LaboratoryConsentFlagCollection", true
	default:
		return "", false
	}
}

// consentFlagKey — org isn't part of the key because it's implied by which
// org-specific collection the flag lives in.
func consentFlagKey(patientID string, resourceType string) string {
	return fmt.Sprintf("CFLAG_%s_%s", patientID, resourceType)
}

// consentIndexKey creates a composite key for HasActiveConsent lookups —
// same pattern as doctorPatientIndexKey in treatment_relationship_contract.go.
// A patient can only have one indexed consent per (org, resourceType); a
// newer GrantConsent for the same triple overwrites the index, which is the
// desired "latest grant wins" behavior.
func consentIndexKey(patientID string, granteeOrg string, resourceType string) string {
	return fmt.Sprintf("CON_IDX_%s_%s_%s", patientID, granteeOrg, resourceType)
}

func (s *SmartContract) GrantConsent(
	ctx contractapi.TransactionContextInterface,
	consentID string,
	patientID string,
	granteeOrg string,
	resourceType string,
	permission string,
	status string,
	expiryDate string,
	createdAt string,
	updatedAt string,
) error {

	err := policy.EnforcePolicy(
		ctx,
		"GRANT_CONSENT",
	)
	if err != nil {
		return err
	}
	exists, err := assetExistsInCollection(
		ctx,
		ConsentCollection,
		"CON_" + consentID,
	)
	if err != nil {
		return err
	}

	if exists {
		return fmt.Errorf("consent %s already exists", consentID)
	}

	if expiryDate != "" {
		if _, perr := time.Parse(time.RFC3339, expiryDate); perr != nil {
			return fmt.Errorf("expiryDate must be RFC3339 or empty: %v", perr)
		}
	}

	consent := models.Consent{
		ConsentID:    consentID,
		PatientID:    patientID,
		GranteeOrg:   granteeOrg,
		ResourceType: resourceType,
		Permission:   permission,
		Status:       status,
		ExpiryDate:   expiryDate,
		CreatedAt:    createdAt,
		UpdatedAt:    updatedAt,
	}

	consentJSON, err := json.Marshal(consent)
	if err != nil {
		return err
	}

	if err := ctx.GetStub().PutPrivateData(
		ConsentCollection,
		"CON_" + consentID,
		consentJSON,
	); err != nil {
		return err
	}

	// Index for HasActiveConsent lookups by (patientID, granteeOrg, resourceType).
	// Only ever readable/writable from a HospitalMSP identity — kept for any
	// future Hospital-side self-check, but HasActiveConsent itself no longer
	// reads this (see below): it can't, since it may be called from a
	// non-Hospital identity that isn't a member of ConsentCollection at all.
	idxKey := consentIndexKey(patientID, granteeOrg, resourceType)
	if err := ctx.GetStub().PutPrivateData(
		ConsentCollection,
		idxKey,
		[]byte(consentID),
	); err != nil {
		return err
	}

	// Mirror a minimal flag into the grantee org's own collection, if they
	// have one. This is the only thing that org's peers ever see about
	// consent — no Permission, no ConsentID, nothing about other patients or
	// other orgs' grants.
	if flagCollection, ok := consentFlagCollectionForOrg(granteeOrg); ok {
		flag := models.ConsentFlag{
			Status:     status,
			ExpiryDate: expiryDate,
		}
		flagJSON, err := json.Marshal(flag)
		if err != nil {
			return err
		}
		if err := ctx.GetStub().PutPrivateData(
			flagCollection,
			consentFlagKey(patientID, resourceType),
			flagJSON,
		); err != nil {
			return err
		}
	}

	return nil
}
func (s *SmartContract) GetConsent(
	ctx contractapi.TransactionContextInterface,
	consentID string,
) (*models.Consent, error) {
	err := policy.EnforcePolicy(
		ctx,
		"GET_CONSENT",
	)
	if err != nil {
		return nil, err
	}

	consentJSON, err := ctx.GetStub().GetPrivateData(
		ConsentCollection,
		"CON_" + consentID,
	)
	if err != nil {
		return nil, err
	}

	if consentJSON == nil {
		return nil, fmt.Errorf("consent %s does not exist", consentID)
	}

	var consent models.Consent

	err = json.Unmarshal(consentJSON, &consent)
	if err != nil {
		return nil, err
	}

	return &consent, nil
}
func (s *SmartContract) CheckConsent(
	ctx contractapi.TransactionContextInterface,
	consentID string,
) (bool, error) {
	err := policy.EnforcePolicy(
		ctx,
		"CHECK_CONSENT",
	)
	if err != nil {
		return false, err
	}

	consent, err := s.GetConsent(ctx, consentID)
	if err != nil {
		return false, err
	}

	if consent.Status != "ACTIVE" {
		return false, nil
	}

	return true, nil
}

// HasActiveConsent answers "does patientID have ACTIVE, non-expired consent
// granting granteeOrg access to resourceType?" It reads granteeOrg's OWN flag
// collection (e.g. PharmacyConsentFlagCollection) — never ConsentCollection,
// which only HospitalMSP is a member of and which a Pharmacy/Laboratory
// identity has no read access to at all. If granteeOrg has no dedicated flag
// collection (consentFlagCollectionForOrg returns false), there's no way for
// this org to ever have an active consent recorded — false, same as "no
// consent found".
//
// A missing flag, wrong status, or expired date all just fall through to
// false — no active consent.
func (s *SmartContract) HasActiveConsent(
	ctx contractapi.TransactionContextInterface,
	patientID string,
	granteeOrg string,
	resourceType string,
) (bool, error) {
	err := policy.EnforcePolicy(
		ctx,
		"CHECK_ACTIVE_CONSENT",
	)
	if err != nil {
		return false, err
	}

	// Bind granteeOrg to the caller: only HospitalMSP may query on behalf of
	// another org; every other org may only ask about itself.
	callerOrg, err := ctx.GetClientIdentity().GetMSPID()
	if err != nil {
		return false, err
	}
	if callerOrg != "HospitalMSP" && callerOrg != granteeOrg {
		return false, fmt.Errorf(
			"access denied: %s may not query consent on behalf of %s",
			callerOrg,
			granteeOrg,
		)
	}

	flagCollection, ok := consentFlagCollectionForOrg(granteeOrg)
	if !ok {
		return false, nil
	}

	flagJSON, err := ctx.GetStub().GetPrivateData(flagCollection, consentFlagKey(patientID, resourceType))
	if err != nil || flagJSON == nil {
		return false, nil
	}

	var flag models.ConsentFlag
	if err := json.Unmarshal(flagJSON, &flag); err != nil {
		return false, nil
	}

	if flag.Status != "ACTIVE" {
		return false, nil
	}

	if flag.ExpiryDate != "" {
		expiry, err := time.Parse(time.RFC3339, flag.ExpiryDate)
		// Fail closed: an unparseable expiry must not mean "never expires".
		if err != nil || time.Now().After(expiry) {
			return false, nil
		}
	}

	return true, nil
}

func (s *SmartContract) RevokeConsent(
	ctx contractapi.TransactionContextInterface,
	consentID string,
	updatedAt string,
) error {
	err := policy.EnforcePolicy(
		ctx,
		"REVOKE_CONSENT",
	)
	if err != nil {
		return err
	}


	consent, err := s.GetConsent(ctx, consentID)
	if err != nil {
		return err
	}

	consent.Status = "REVOKED"
	consent.UpdatedAt = updatedAt

	consentJSON, err := json.Marshal(consent)
	if err != nil {
		return err
	}

	if err := ctx.GetStub().PutPrivateData(
		ConsentCollection,
		"CON_" + consentID,
		consentJSON,
	); err != nil {
		return err
	}

	// Only flip the mirrored flag if this consent is the one the flag
	// currently reflects ("latest grant wins" index). Revoking a superseded
	// consent must not kill a newer active grant for the same
	// (patient, org, resourceType).
	idxBytes, err := ctx.GetStub().GetPrivateData(
		ConsentCollection,
		consentIndexKey(consent.PatientID, consent.GranteeOrg, consent.ResourceType),
	)
	if err != nil {
		return err
	}
	if flagCollection, ok := consentFlagCollectionForOrg(consent.GranteeOrg); ok && (len(idxBytes) == 0 || string(idxBytes) == consentID) {
		flag := models.ConsentFlag{
			Status:     "REVOKED",
			ExpiryDate: consent.ExpiryDate,
		}
		flagJSON, err := json.Marshal(flag)
		if err != nil {
			return err
		}
		if err := ctx.GetStub().PutPrivateData(
			flagCollection,
			consentFlagKey(consent.PatientID, consent.ResourceType),
			flagJSON,
		); err != nil {
			return err
		}
	}

	return nil
}
