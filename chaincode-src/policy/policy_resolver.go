package policy

import (
	"fmt"
	"strings"
)

// BuildPolicy converts MSP list into a Fabric policy string
func BuildPolicy(msps []string) string {

	if len(msps) == 0 {
		return ""
	}

	peers := []string{}

	for _, msp := range msps {
		peers = append(peers, fmt.Sprintf("'%s.peer'", msp))
	}

	return fmt.Sprintf(
		"OutOf(%d,%s)",
		len(msps),
		strings.Join(peers, ","),
	)
}

// GetPolicyForTx returns the policy string for a transaction type
func GetPolicyForTx(txType string) (string, error) {

	msps, exists := PolicyRegistry[txType]
	if !exists {
		return "", fmt.Errorf(
			"no policy found for transaction type: %s",
			txType,
		)
	}

	policy := BuildPolicy(msps)

	return policy, nil
}