#!/bin/bash

ORG=$1

if [ -z "$ORG" ]; then
  echo "Usage: source setPeer.sh <org>"
  echo "orgs: research | governance | pharmacy | laboratory | hospital"
  return 1
fi

case $ORG in

  research)
    export CORE_PEER_LOCALMSPID=ResearchMSP
    export CORE_PEER_MSPCONFIGPATH=/opt/gopath/src/github.com/hyperledger/fabric/peer/organizations/peerOrganizations/research.medvault.com/users/Admin@research.medvault.com/msp
    export CORE_PEER_ADDRESS=peer0.research.medvault.com:11051
    export CORE_PEER_TLS_ROOTCERT_FILE=/opt/gopath/src/github.com/hyperledger/fabric/peer/organizations/peerOrganizations/research.medvault.com/peers/peer0.research.medvault.com/tls/ca.crt
    echo "Switched to RESEARCH"
    ;;

  governance)
    export CORE_PEER_LOCALMSPID=GovernanceMSP
    export CORE_PEER_MSPCONFIGPATH=/opt/gopath/src/github.com/hyperledger/fabric/peer/organizations/peerOrganizations/governance.medvault.com/users/Admin@governance.medvault.com/msp
    export CORE_PEER_ADDRESS=peer0.governance.medvault.com:9051
    export CORE_PEER_TLS_ROOTCERT_FILE=/opt/gopath/src/github.com/hyperledger/fabric/peer/organizations/peerOrganizations/governance.medvault.com/peers/peer0.governance.medvault.com/tls/ca.crt
    echo "Switched to GOVERNANCE"
    ;;

  pharmacy)
    export CORE_PEER_LOCALMSPID=PharmacyMSP
    export CORE_PEER_MSPCONFIGPATH=/opt/gopath/src/github.com/hyperledger/fabric/peer/organizations/peerOrganizations/pharmacy.medvault.com/users/Admin@pharmacy.medvault.com/msp
    export CORE_PEER_ADDRESS=peer0.pharmacy.medvault.com:10051
    export CORE_PEER_TLS_ROOTCERT_FILE=/opt/gopath/src/github.com/hyperledger/fabric/peer/organizations/peerOrganizations/pharmacy.medvault.com/peers/peer0.pharmacy.medvault.com/tls/ca.crt
    echo "Switched to PHARMACY"
    ;;

  laboratory)
    export CORE_PEER_LOCALMSPID=LaboratoryMSP
    export CORE_PEER_MSPCONFIGPATH=/opt/gopath/src/github.com/hyperledger/fabric/peer/organizations/peerOrganizations/laboratory.medvault.com/users/Admin@laboratory.medvault.com/msp
    export CORE_PEER_ADDRESS=peer0.laboratory.medvault.com:8051
    export CORE_PEER_TLS_ROOTCERT_FILE=/opt/gopath/src/github.com/hyperledger/fabric/peer/organizations/peerOrganizations/laboratory.medvault.com/peers/peer0.laboratory.medvault.com/tls/ca.crt
    echo "Switched to LABORATORY"
    ;;

  hospital)
    export CORE_PEER_LOCALMSPID=HospitalMSP
    export CORE_PEER_MSPCONFIGPATH=/opt/gopath/src/github.com/hyperledger/fabric/peer/organizations/peerOrganizations/hospital.medvault.com/users/Admin@hospital.medvault.com/msp
    export CORE_PEER_ADDRESS=peer0.hospital.medvault.com:7051
    export CORE_PEER_TLS_ROOTCERT_FILE=/opt/gopath/src/github.com/hyperledger/fabric/peer/organizations/peerOrganizations/hospital.medvault.com/peers/peer0.hospital.medvault.com/tls/ca.crt
    echo "Switched to HOSPITAL"
    ;;

  *)
    echo "Invalid org"
    ;;
esac
