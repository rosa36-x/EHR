package policy

import (
	"fmt"

	"github.com/hyperledger/fabric-contract-api-go/contractapi"
)

func EnforcePolicy(
	ctx contractapi.TransactionContextInterface,
	txType string,
) error {

	policy, err := GetPolicyForTx(txType)
	if err != nil {
		return fmt.Errorf(
			"policy resolution failed: %s",
			err.Error(),
		)
	}

	// Temporary placeholder
	fmt.Printf("Enforcing policy: %s\n", policy)

	return nil
}