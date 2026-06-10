#!/bin/bash
# network.sh
# MedVault EHR Network — Single entrypoint
#
# BOOTSTRAP METHOD: Fabric 2.5 Channel Participation API
#   - No system channel. No genesis block file passed to orderer at startup.
#   - configtxgen generates the channel genesis block (medchannel.block)
#   - osnadmin delivers it to the orderer admin port (7053)
#   - Each peer then joins via: peer channel join
#
# Usage:
#   ./network.sh up      — full bring-up: CAs → enroll → artifacts → peers → channel
#   ./network.sh down    — stop containers, remove volumes
#   ./network.sh clean   — down + wipe ALL generated material (crypto + CA DBs + artifacts)
#   ./network.sh channel — (re)create channel only, network must already be up

set -e

FABRIC_BIN="${FABRIC_BIN:-$HOME/hyperledger/fabric-samples/bin}"
export PATH="$FABRIC_BIN:$PATH"
export FABRIC_CFG_PATH="$(pwd)"

CHANNEL_NAME="medchannel"
COMPOSE_FILE="docker/docker-compose.yaml"

ORDERER_ADMIN_ADDRESS="localhost:7053"
ORDERER_CA="organizations/ordererOrganizations/medvault.com/orderers/orderer.medvault.com/tls/ca.crt"
ORDERER_ADMIN_TLS_SIGN_CERT="organizations/ordererOrganizations/medvault.com/orderers/orderer.medvault.com/tls/server.crt"
ORDERER_ADMIN_TLS_PRIVATE_KEY="organizations/ordererOrganizations/medvault.com/orderers/orderer.medvault.com/tls/server.key"

# ── HELPER: peer channel join ─────────────────────────────────────────────────
function joinChannel() {
  local MSP_ID=$1
  local PEER_ADDR=$2
  local ADMIN_MSP=$3
  local TLS_CERT=$4

  echo "    Joining ${PEER_ADDR} to ${CHANNEL_NAME}..."

  CORE_PEER_LOCALMSPID="${MSP_ID}" \
  CORE_PEER_ADDRESS="${PEER_ADDR}" \
  CORE_PEER_MSPCONFIGPATH="${ADMIN_MSP}" \
  CORE_PEER_TLS_ROOTCERT_FILE="${TLS_CERT}" \
  CORE_PEER_TLS_ENABLED=true \
  peer channel join -b "channel-artifacts/${CHANNEL_NAME}.block"
}

# ── HELPER: set anchor peer ───────────────────────────────────────────────────
function setAnchorPeer() {
  local MSP_ID=$1
  local PEER_ADDR=$2
  local ADMIN_MSP=$3
  local TLS_CERT=$4
  local ORG_NAME=$5

  echo "    Setting anchor peer for ${ORG_NAME}..."

  CORE_PEER_LOCALMSPID="${MSP_ID}" \
  CORE_PEER_ADDRESS="${PEER_ADDR}" \
  CORE_PEER_MSPCONFIGPATH="${ADMIN_MSP}" \
  CORE_PEER_TLS_ROOTCERT_FILE="${TLS_CERT}" \
  CORE_PEER_TLS_ENABLED=true \
  peer channel fetch config "channel-artifacts/config_block_${ORG_NAME}.pb" \
    -o "localhost:7050" \
    --ordererTLSHostnameOverride orderer.medvault.com \
    -c "${CHANNEL_NAME}" \
    --tls --cafile "${ORDERER_CA}"

  cd channel-artifacts

  configtxlator proto_decode \
    --input "config_block_${ORG_NAME}.pb" \
    --type common.Block | jq .data.data[0].payload.data.config > "config_${ORG_NAME}.json"

  PEER_HOST=$(echo $PEER_ADDR | cut -d: -f1)
  PEER_PORT=$(echo $PEER_ADDR | cut -d: -f2)

  jq '.channel_group.groups.Application.groups.'${MSP_ID}'.values += {
    "AnchorPeers": {
      "mod_policy": "Admins",
      "value": {"anchor_peers": [{"host": "'"${PEER_HOST}"'","port": '"${PEER_PORT}"'}]},
      "version": "0"
    }
  }' "config_${ORG_NAME}.json" > "modified_config_${ORG_NAME}.json"

  configtxlator proto_encode \
    --input "config_${ORG_NAME}.json" \
    --type common.Config \
    --output "config_${ORG_NAME}.pb"

  configtxlator proto_encode \
    --input "modified_config_${ORG_NAME}.json" \
    --type common.Config \
    --output "modified_config_${ORG_NAME}.pb"

  configtxlator compute_update \
    --channel_id "${CHANNEL_NAME}" \
    --original  "config_${ORG_NAME}.pb" \
    --updated   "modified_config_${ORG_NAME}.pb" \
    --output    "config_update_${ORG_NAME}.pb"

  echo '{"payload":{"header":{"channel_header":{"channel_id":"'${CHANNEL_NAME}'","type":2}},"data":{"config_update":'$(configtxlator proto_decode --input config_update_${ORG_NAME}.pb --type common.ConfigUpdate)'}}}' \
    | jq . > "config_update_in_envelope_${ORG_NAME}.json"

  configtxlator proto_encode \
    --input "config_update_in_envelope_${ORG_NAME}.json" \
    --type  common.Envelope \
    --output "config_update_in_envelope_${ORG_NAME}.pb"

  cd ..

  CORE_PEER_LOCALMSPID="${MSP_ID}" \
  CORE_PEER_ADDRESS="${PEER_ADDR}" \
  CORE_PEER_MSPCONFIGPATH="${ADMIN_MSP}" \
  CORE_PEER_TLS_ROOTCERT_FILE="${TLS_CERT}" \
  CORE_PEER_TLS_ENABLED=true \
  peer channel update \
    -f "channel-artifacts/config_update_in_envelope_${ORG_NAME}.pb" \
    -c "${CHANNEL_NAME}" \
    -o "localhost:7050" \
    --ordererTLSHostnameOverride orderer.medvault.com \
    --tls --cafile "${ORDERER_CA}"
}

# ── generateArtifacts ─────────────────────────────────────────────────────────
function generateArtifacts() {
  echo "[3/6] Generating channel genesis block..."
  mkdir -p channel-artifacts

  configtxgen \
    -profile MedVaultChannel \
    -outputBlock "channel-artifacts/${CHANNEL_NAME}.block" \
    -channelID "${CHANNEL_NAME}"

  echo "      channel-artifacts/${CHANNEL_NAME}.block written."
}

# ── createChannel ─────────────────────────────────────────────────────────────
function createChannel() {
  echo "[5/6] Joining orderer to channel via osnadmin..."

  osnadmin channel join \
    --channelID "${CHANNEL_NAME}" \
    --config-block "channel-artifacts/${CHANNEL_NAME}.block" \
    -o "${ORDERER_ADMIN_ADDRESS}" \
    --ca-file     "${ORDERER_CA}" \
    --client-cert "${ORDERER_ADMIN_TLS_SIGN_CERT}" \
    --client-key  "${ORDERER_ADMIN_TLS_PRIVATE_KEY}"

  echo "      Orderer joined. Waiting 3s..."
  sleep 3

  echo "[6/6] Joining peers and setting anchor peers..."

  joinChannel "HospitalMSP"   "localhost:7051" \
    "organizations/peerOrganizations/hospital.medvault.com/users/Admin@hospital.medvault.com/msp" \
    "organizations/peerOrganizations/hospital.medvault.com/peers/peer0.hospital.medvault.com/tls/ca.crt"

  joinChannel "LaboratoryMSP" "localhost:8051" \
    "organizations/peerOrganizations/laboratory.medvault.com/users/Admin@laboratory.medvault.com/msp" \
    "organizations/peerOrganizations/laboratory.medvault.com/peers/peer0.laboratory.medvault.com/tls/ca.crt"

  joinChannel "GovernanceMSP" "localhost:9051" \
    "organizations/peerOrganizations/governance.medvault.com/users/Admin@governance.medvault.com/msp" \
    "organizations/peerOrganizations/governance.medvault.com/peers/peer0.governance.medvault.com/tls/ca.crt"

  joinChannel "PharmacyMSP"   "localhost:10051" \
    "organizations/peerOrganizations/pharmacy.medvault.com/users/Admin@pharmacy.medvault.com/msp" \
    "organizations/peerOrganizations/pharmacy.medvault.com/peers/peer0.pharmacy.medvault.com/tls/ca.crt"

  joinChannel "ResearchMSP"   "localhost:11051" \
    "organizations/peerOrganizations/research.medvault.com/users/Admin@research.medvault.com/msp" \
    "organizations/peerOrganizations/research.medvault.com/peers/peer0.research.medvault.com/tls/ca.crt"

  setAnchorPeer "HospitalMSP"   "localhost:7051" \
    "organizations/peerOrganizations/hospital.medvault.com/users/Admin@hospital.medvault.com/msp" \
    "organizations/peerOrganizations/hospital.medvault.com/peers/peer0.hospital.medvault.com/tls/ca.crt" \
    "Hospital"

  setAnchorPeer "LaboratoryMSP" "localhost:8051" \
    "organizations/peerOrganizations/laboratory.medvault.com/users/Admin@laboratory.medvault.com/msp" \
    "organizations/peerOrganizations/laboratory.medvault.com/peers/peer0.laboratory.medvault.com/tls/ca.crt" \
    "Laboratory"

  setAnchorPeer "GovernanceMSP" "localhost:9051" \
    "organizations/peerOrganizations/governance.medvault.com/users/Admin@governance.medvault.com/msp" \
    "organizations/peerOrganizations/governance.medvault.com/peers/peer0.governance.medvault.com/tls/ca.crt" \
    "Governance"
}

# ── networkUp ─────────────────────────────────────────────────────────────────
function networkUp() {
  echo ""
  echo "══════════════════════════════════════════════"
  echo " MedVault Network — Starting up (Fabric 2.5)"
  echo "══════════════════════════════════════════════"

  echo "[1/6] Starting Fabric CA containers..."
  docker compose -f "${COMPOSE_FILE}" up -d \
    ca.orderer.medvault.com \
    ca.hospital.medvault.com \
    ca.laboratory.medvault.com \
    ca.governance.medvault.com \
    ca.pharmacy.medvault.com \
    ca.research.medvault.com

  echo "      Waiting 5s for CAs to initialize..."
  sleep 5

  echo "[2/6] Running registerEnroll.sh..."
  chmod +x registerEnroll.sh
  ./registerEnroll.sh

  generateArtifacts

  echo "[4/6] Starting orderer and peers..."
  docker compose -f "${COMPOSE_FILE}" up -d \
    orderer.medvault.com \
    peer0.hospital.medvault.com \
    peer0.laboratory.medvault.com \
    peer0.governance.medvault.com \
    peer0.pharmacy.medvault.com \
    peer0.research.medvault.com

  echo "      Waiting 8s for orderer and peers to initialize..."
  sleep 8

  createChannel

  echo ""
  docker ps --format "table {{.Names}}\t{{.Status}}" | grep medvault || true

  echo ""
  echo "══════════════════════════════════════════════"
  echo " Network is up. Channel: ${CHANNEL_NAME}"
  echo " Active orgs:   Hospital, Laboratory, Governance"
  echo " Skeleton orgs: Pharmacy, Research"
  echo "══════════════════════════════════════════════"
}

# ── networkDown ───────────────────────────────────────────────────────────────
function networkDown() {
  echo "Stopping network..."
  docker compose -f "${COMPOSE_FILE}" down --volumes --remove-orphans 2>/dev/null || true
  echo "Done."
}

# ── networkClean ──────────────────────────────────────────────────────────────
# Wipes everything so the next `up` starts completely fresh:
#   1. Stops containers and removes Docker volumes
#   2. Deletes generated crypto material (peerOrgs, ordererOrg)
#   3. Deletes CA SQLite databases — this is what prevents "already registered"
#      errors on re-runs. The CA DB lives inside organizations/fabric-ca/ which
#      is bind-mounted into the CA containers. Docker `down --volumes` only
#      removes named Docker volumes, NOT bind-mount directories on the host.
#   4. Deletes channel artifacts
function networkClean() {
  networkDown

  # Fix ownership of CA bind-mount dirs so rm works
  sudo chown -R $USER:$USER organizations/ 2>/dev/null || true

  echo "Removing generated crypto material..."
  rm -rf organizations/peerOrganizations
  rm -rf organizations/ordererOrganizations

  echo "Wiping CA databases..."
  for CA_DIR in \
      organizations/fabric-ca/ordererOrg \
      organizations/fabric-ca/hospital \
      organizations/fabric-ca/laboratory \
      organizations/fabric-ca/governance \
      organizations/fabric-ca/pharmacy \
      organizations/fabric-ca/research; do
    rm -f  "${CA_DIR}/fabric-ca-server.db"
    rm -f  "${CA_DIR}/tls-cert.pem"
    rm -rf "${CA_DIR}/msp"
    rm -rf "${CA_DIR}/IssuerPublicKey"
    rm -rf "${CA_DIR}/IssuerRevocationPublicKey"
    # Verify the DB is actually gone
    if [ -f "${CA_DIR}/fabric-ca-server.db" ]; then
      echo "ERROR: Could not delete ${CA_DIR}/fabric-ca-server.db — run with sudo"
      exit 1
    fi
  done

  echo "Removing channel artifacts..."
  rm -rf channel-artifacts/

  echo "Clean complete. Run './network.sh up' to start fresh."
}

# ── ENTRYPOINT ────────────────────────────────────────────────────────────────
case "$1" in
  up)      networkUp ;;
  down)    networkDown ;;
  clean)   networkClean ;;
  channel) createChannel ;;
  *)
    echo "Usage: ./network.sh [up|down|clean|channel]"
    echo ""
    echo "  up       — Full bring-up: CAs → enroll → genesis → peers → channel"
    echo "  down     — Stop all containers and remove Docker volumes"
    echo "  clean    — down + delete all crypto material, CA databases, artifacts"
    echo "  channel  — (Re)join channel only (network must already be up)"
    exit 1
    ;;
esac
