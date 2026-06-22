package main

import (
	
	"github.com/hyperledger/fabric-contract-api-go/contractapi"
)

type SmartContract struct {
	contractapi.Contract
}
const (
	PatientCollection      = "PatientRecordCollection"
	ConsentCollection      = "ConsentCollection"
	PrescriptionCollection = "PrescriptionCollection"
	LabReportCollection    = "LabReportCollection"
)
func assetExistsInCollection(
	ctx contractapi.TransactionContextInterface,
	collection string,
	key string,
) (bool, error) {

	data, err := ctx.GetStub().GetPrivateData(collection, key)
	if err != nil {
		return false, err
	}

	return data != nil, nil
}
