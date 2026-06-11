#!/bin/bash
# registerEnroll.sh
# Uses Fabric CA to generate all org identities.
# Replaces cryptogen entirely.
# Run AFTER CA containers are up, BEFORE configtxgen.

set -e

FABRIC_BIN="${FABRIC_BIN:-$HOME/hyperledger/fabric-samples/bin}"
export PATH="$FABRIC_BIN:$PATH"

# Base directory — all paths relative to here
ROOTDIR="$(pwd)"

# We set FABRIC_CA_CLIENT_HOME per-org as we go, so configs never bleed across orgs

function writeNodeOUs() {
  local MSP_DIR=$1
  local CA_CERT_NAME=$2
  mkdir -p "${MSP_DIR}"
  cat > "${MSP_DIR}/config.yaml" << YAML
NodeOUs:
  Enable: true
  ClientOUIdentifier:
    Certificate: cacerts/${CA_CERT_NAME}
    OrganizationalUnitIdentifier: client
  PeerOUIdentifier:
    Certificate: cacerts/${CA_CERT_NAME}
    OrganizationalUnitIdentifier: peer
  AdminOUIdentifier:
    Certificate: cacerts/${CA_CERT_NAME}
    OrganizationalUnitIdentifier: admin
  OrdererOUIdentifier:
    Certificate: cacerts/${CA_CERT_NAME}
    OrganizationalUnitIdentifier: orderer
YAML
}

# ── ORDERER ORG ───────────────────────────────────────────────────────────────
echo ""
echo "════════════════════════════════════════════════════════"
echo " Enrolling Orderer Org"
echo "════════════════════════════════════════════════════════"

export FABRIC_CA_CLIENT_HOME="${ROOTDIR}/organizations/ordererOrganizations/medvault.com"
ORG_DIR="${ROOTDIR}/organizations/ordererOrganizations/medvault.com"
TLS_CERT="${ROOTDIR}/organizations/fabric-ca/ordererOrg/ca-cert.pem"
CA_HOST="localhost:7054"
CA_NAME="ca-orderer"

mkdir -p "${ORG_DIR}/msp" "${ORG_DIR}/ca"

# Enroll CA bootstrap admin — gets us the org root CA cert
fabric-ca-client enroll \
  -u "https://admin:adminpw@${CA_HOST}" \
  --caname "${CA_NAME}" \
  --tls.certfiles "${TLS_CERT}" \
  -M "${ORG_DIR}/msp"

CA_CERT_NAME=$(ls ${ORG_DIR}/msp/cacerts/)
cp "${ORG_DIR}/msp/cacerts/${CA_CERT_NAME}" "${ORG_DIR}/ca/ca.orderer.medvault.com-cert.pem"
writeNodeOUs "${ORG_DIR}/msp" "${CA_CERT_NAME}"

# Register orderer node identity
fabric-ca-client register \
  -u "https://admin:adminpw@${CA_HOST}" \
  --caname "${CA_NAME}" \
  --id.name orderer \
  --id.secret ordererpw \
  --id.type orderer \
  --tls.certfiles "${TLS_CERT}"

# Register orderer org admin
fabric-ca-client register \
  -u "https://admin:adminpw@${CA_HOST}" \
  --caname "${CA_NAME}" \
  --id.name ordererAdmin \
  --id.secret ordererAdminpw \
  --id.type admin \
  --tls.certfiles "${TLS_CERT}"

# Enroll orderer node MSP
mkdir -p "${ORG_DIR}/orderers/orderer.medvault.com/msp"
mkdir -p "${ORG_DIR}/orderers/orderer.medvault.com/tls"

fabric-ca-client enroll \
  -u "https://orderer:ordererpw@${CA_HOST}" \
  --caname "${CA_NAME}" \
  -M "${ORG_DIR}/orderers/orderer.medvault.com/msp" \
  --tls.certfiles "${TLS_CERT}"

writeNodeOUs \
  "${ORG_DIR}/orderers/orderer.medvault.com/msp" \
  "$(ls ${ORG_DIR}/orderers/orderer.medvault.com/msp/cacerts/)"

# Enroll orderer node TLS
fabric-ca-client enroll \
  -u "https://orderer:ordererpw@${CA_HOST}" \
  --caname "${CA_NAME}" \
  -M "${ORG_DIR}/orderers/orderer.medvault.com/tls" \
  --enrollment.profile tls \
  --csr.hosts "orderer.medvault.com,localhost" \
  --tls.certfiles "${TLS_CERT}"

cp "${ORG_DIR}/orderers/orderer.medvault.com/tls/keystore/"*   "${ORG_DIR}/orderers/orderer.medvault.com/tls/server.key"
cp "${ORG_DIR}/orderers/orderer.medvault.com/tls/signcerts/"*  "${ORG_DIR}/orderers/orderer.medvault.com/tls/server.crt"
cp "${ORG_DIR}/orderers/orderer.medvault.com/tls/tlscacerts/"* "${ORG_DIR}/orderers/orderer.medvault.com/tls/ca.crt"

# Enroll orderer admin
mkdir -p "${ORG_DIR}/users/Admin@medvault.com/msp"

fabric-ca-client enroll \
  -u "https://ordererAdmin:ordererAdminpw@${CA_HOST}" \
  --caname "${CA_NAME}" \
  -M "${ORG_DIR}/users/Admin@medvault.com/msp" \
  --tls.certfiles "${TLS_CERT}"

writeNodeOUs \
  "${ORG_DIR}/users/Admin@medvault.com/msp" \
  "$(ls ${ORG_DIR}/users/Admin@medvault.com/msp/cacerts/)"

echo "    Orderer org done."

# ── PEER ORG HELPER ───────────────────────────────────────────────────────────
# Shared logic for enrolling a peer org — called once per org below

function enrollPeerOrg() {
  local ORG_NAME=$1       # e.g. hospital
  local CA_PORT=$2        # e.g. 8054
  local CA_NAME=$3        # e.g. ca-hospital
  local DOMAIN=$4         # e.g. hospital.medvault.com
  local EXTRA_USERS=$5    # e.g. "doctor1:doctor1pw" — space separated, optional

  echo ""
  echo "════════════════════════════════════════════════════════"
  echo " Enrolling ${ORG_NAME} Org"
  echo "════════════════════════════════════════════════════════"

  local ORG_DIR="${ROOTDIR}/organizations/peerOrganizations/${DOMAIN}"
  local TLS_CERT="${ROOTDIR}/organizations/fabric-ca/${ORG_NAME}/ca-cert.pem"
  local CA_HOST="localhost:${CA_PORT}"

  export FABRIC_CA_CLIENT_HOME="${ORG_DIR}"
  mkdir -p "${ORG_DIR}/msp" "${ORG_DIR}/ca"

  # Enroll CA bootstrap admin
  fabric-ca-client enroll \
    -u "https://admin:adminpw@${CA_HOST}" \
    --caname "${CA_NAME}" \
    --tls.certfiles "${TLS_CERT}" \
    -M "${ORG_DIR}/msp"

  local CA_CERT_NAME=$(ls ${ORG_DIR}/msp/cacerts/)
  cp "${ORG_DIR}/msp/cacerts/${CA_CERT_NAME}" "${ORG_DIR}/ca/ca.${DOMAIN}-cert.pem"
  writeNodeOUs "${ORG_DIR}/msp" "${CA_CERT_NAME}"

  # Register peer0
  fabric-ca-client register \
    -u "https://admin:adminpw@${CA_HOST}" \
    --caname "${CA_NAME}" \
    --id.name "peer0.${DOMAIN}" \
    --id.secret peer0pw \
    --id.type peer \
    --tls.certfiles "${TLS_CERT}"

  # Register org admin
  fabric-ca-client register \
    -u "https://admin:adminpw@${CA_HOST}" \
    --caname "${CA_NAME}" \
    --id.name "${ORG_NAME}Admin" \
    --id.secret "${ORG_NAME}Adminpw" \
    --id.type admin \
    --tls.certfiles "${TLS_CERT}"

  # Register any extra app-level users
  for USER_INFO in $EXTRA_USERS; do
    local UNAME=$(echo $USER_INFO | cut -d: -f1)
    local UPWD=$(echo $USER_INFO | cut -d: -f2)
    fabric-ca-client register \
      -u "https://admin:adminpw@${CA_HOST}" \
      --caname "${CA_NAME}" \
      --id.name "${UNAME}" \
      --id.secret "${UPWD}" \
      --id.type client \
      --tls.certfiles "${TLS_CERT}"
  done

  # Enroll peer0 MSP
  mkdir -p "${ORG_DIR}/peers/peer0.${DOMAIN}/msp"
  mkdir -p "${ORG_DIR}/peers/peer0.${DOMAIN}/tls"

  fabric-ca-client enroll \
    -u "https://peer0.${DOMAIN}:peer0pw@${CA_HOST}" \
    --caname "${CA_NAME}" \
    -M "${ORG_DIR}/peers/peer0.${DOMAIN}/msp" \
    --tls.certfiles "${TLS_CERT}"

  writeNodeOUs \
    "${ORG_DIR}/peers/peer0.${DOMAIN}/msp" \
    "$(ls ${ORG_DIR}/peers/peer0.${DOMAIN}/msp/cacerts/)"

  # Enroll peer0 TLS
  fabric-ca-client enroll \
    -u "https://peer0.${DOMAIN}:peer0pw@${CA_HOST}" \
    --caname "${CA_NAME}" \
    -M "${ORG_DIR}/peers/peer0.${DOMAIN}/tls" \
    --enrollment.profile tls \
    --csr.hosts "peer0.${DOMAIN},localhost" \
    --tls.certfiles "${TLS_CERT}"

  cp "${ORG_DIR}/peers/peer0.${DOMAIN}/tls/keystore/"*   "${ORG_DIR}/peers/peer0.${DOMAIN}/tls/server.key"
  cp "${ORG_DIR}/peers/peer0.${DOMAIN}/tls/signcerts/"*  "${ORG_DIR}/peers/peer0.${DOMAIN}/tls/server.crt"
  cp "${ORG_DIR}/peers/peer0.${DOMAIN}/tls/tlscacerts/"* "${ORG_DIR}/peers/peer0.${DOMAIN}/tls/ca.crt"

  # Enroll org admin
  mkdir -p "${ORG_DIR}/users/Admin@${DOMAIN}/msp"

  fabric-ca-client enroll \
    -u "https://${ORG_NAME}Admin:${ORG_NAME}Adminpw@${CA_HOST}" \
    --caname "${CA_NAME}" \
    -M "${ORG_DIR}/users/Admin@${DOMAIN}/msp" \
    --tls.certfiles "${TLS_CERT}"

  writeNodeOUs \
    "${ORG_DIR}/users/Admin@${DOMAIN}/msp" \
    "$(ls ${ORG_DIR}/users/Admin@${DOMAIN}/msp/cacerts/)"

  # Enroll extra app-level users
  for USER_INFO in $EXTRA_USERS; do
    local UNAME=$(echo $USER_INFO | cut -d: -f1)
    local UPWD=$(echo $USER_INFO | cut -d: -f2)
    mkdir -p "${ORG_DIR}/users/${UNAME}@${DOMAIN}/msp"
    fabric-ca-client enroll \
      -u "https://${UNAME}:${UPWD}@${CA_HOST}" \
      --caname "${CA_NAME}" \
      -M "${ORG_DIR}/users/${UNAME}@${DOMAIN}/msp" \
      --tls.certfiles "${TLS_CERT}"
  done

  echo "    ${ORG_NAME} org done."
}

# ── ENROLL ALL PEER ORGS ──────────────────────────────────────────────────────

# Active orgs — with app-level users
enrollPeerOrg "hospital"    8054  "ca-hospital"    "hospital.medvault.com"    "doctor1:doctor1pw patient1:patient1pw"
enrollPeerOrg "laboratory"  9054  "ca-laboratory"  "laboratory.medvault.com"  "labtech1:labtech1pw"
enrollPeerOrg "governance"  10054 "ca-governance"  "governance.medvault.com"  ""

# Skeleton orgs — admin only
enrollPeerOrg "pharmacy"    11054 "ca-pharmacy"    "pharmacy.medvault.com"    ""
enrollPeerOrg "research"    12054 "ca-research"    "research.medvault.com"    ""

echo ""
echo "════════════════════════════════════════════════════════"
echo " All identities enrolled successfully."
echo " Next: configtxgen will generate channel artifacts."
echo "════════════════════════════════════════════════════════"
