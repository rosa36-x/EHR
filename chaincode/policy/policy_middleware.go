package policy

import (
	"fmt"

	"github.com/hyperledger/fabric-contract-api-go/contractapi"
)

func EnforcePolicy(
	ctx contractapi.TransactionContextInterface,
	txType string,
) error {

	allowedMSPs, exists := PolicyRegistry[txType]
	if !exists {
		return fmt.Errorf(
			"no policy found for transaction type: %s",
			txType,
		)
	}

	clientIdentity := ctx.GetClientIdentity()

	mspID, err := clientIdentity.GetMSPID()
	if err != nil {
		return fmt.Errorf(
			"failed to get caller MSP ID: %s",
			err.Error(),
		)
	}

	for _, allowedMSP := range allowedMSPs {
		if allowedMSP == mspID {
			fmt.Printf(
				"Policy check passed for MSP %s on transaction %s\n",
				mspID,
				txType,
			)
			return nil
		}
	}

	return fmt.Errorf(
		"access denied: MSP %s is not authorized for transaction %s",
		mspID,
		txType,
	)
}