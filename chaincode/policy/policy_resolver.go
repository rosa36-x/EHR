package policy

import (
	"fmt"
	"strings"
)

// BuildPolicy converts MSP list → Fabric OutOf policy string
func BuildPolicy(msps []string) string {

	if len(msps) == 0 {
		return ""
	}

	peers := []string{}
	for _, msp := range msps {
		peers = append(peers, fmt.Sprintf("'%s.peer'", msp))
	}

	return fmt.Sprintf("OutOf(%d,%s)", len(msps), strings.Join(peers, ","))
}
func GetPolicyForTx(txType string) (string, error) {

    // 1. Fetch policy definition
    policyDef, err := registry.Get(txType)
    if err != nil {
        return "", fmt.Errorf("no policy found for txType: %s", txType)
    }

    // 2. Convert MSPs → peer identities
    peers := make([]string, 0, len(policyDef.MSPS))
    for _, msp := range policyDef.MSPS {
        peers = append(peers, msp+".peer")
    }

    // 3. Build Fabric policy string
    policy := BuildPolicy(policyDef.Type, peers)

    return policy, nil
}