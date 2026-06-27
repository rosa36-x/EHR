import fs from "fs";
import path from "path";
import crypto from "crypto";
import * as grpc from "@grpc/grpc-js";
import pkg from "@hyperledger/fabric-gateway";

const { connect, signers } = pkg;

/**
 * Org configurations.
 * keyPath is auto-resolved via glob for non-hospital orgs
 * since keystore filenames are non-deterministic hashes.
 */
const ORG_CONFIGS = {
    hospital: {
        mspId:        "HospitalMSP",
        peerEndpoint: "localhost:7051",
        peerHostname: "peer0.hospital.medvault.com",
        tlsCertPath:  "../organizations/peerOrganizations/hospital.medvault.com/peers/peer0.hospital.medvault.com/tls/ca.crt",
        certPath:     "../organizations/peerOrganizations/hospital.medvault.com/users/doctor1@hospital.medvault.com/msp/signcerts/cert.pem",
        keyDir:       "../organizations/peerOrganizations/hospital.medvault.com/users/doctor1@hospital.medvault.com/msp/keystore",
    },
    pharmacy: {
        mspId:        "PharmacyMSP",
        peerEndpoint: "localhost:10051",
        peerHostname: "peer0.pharmacy.medvault.com",
        tlsCertPath:  "../organizations/peerOrganizations/pharmacy.medvault.com/peers/peer0.pharmacy.medvault.com/tls/ca.crt",
        certPath:     "../organizations/peerOrganizations/pharmacy.medvault.com/users/Admin@pharmacy.medvault.com/msp/signcerts/cert.pem",
        keyDir:       "../organizations/peerOrganizations/pharmacy.medvault.com/users/Admin@pharmacy.medvault.com/msp/keystore",
    },
    laboratory: {
        mspId:        "LaboratoryMSP",
        peerEndpoint: "localhost:8051",
        peerHostname: "peer0.laboratory.medvault.com",
        tlsCertPath:  "../organizations/peerOrganizations/laboratory.medvault.com/peers/peer0.laboratory.medvault.com/tls/ca.crt",
        certPath:     "../organizations/peerOrganizations/laboratory.medvault.com/users/labtech1@laboratory.medvault.com/msp/signcerts/cert.pem",
        keyDir:       "../organizations/peerOrganizations/laboratory.medvault.com/users/labtech1@laboratory.medvault.com/msp/keystore",
    },
    governance: {
        mspId:        "GovernanceMSP",
        peerEndpoint: "localhost:9051",
        peerHostname: "peer0.governance.medvault.com",
        tlsCertPath:  "../organizations/peerOrganizations/governance.medvault.com/peers/peer0.governance.medvault.com/tls/ca.crt",
        certPath:     "../organizations/peerOrganizations/governance.medvault.com/users/Admin@governance.medvault.com/msp/signcerts/cert.pem",
        keyDir:       "../organizations/peerOrganizations/governance.medvault.com/users/Admin@governance.medvault.com/msp/keystore",
    },
    research: {
        mspId:        "ResearchMSP",
        peerEndpoint: "localhost:11051",
        peerHostname: "peer0.research.medvault.com",
        tlsCertPath:  "../organizations/peerOrganizations/research.medvault.com/peers/peer0.research.medvault.com/tls/ca.crt",
        certPath:     "../organizations/peerOrganizations/research.medvault.com/users/Admin@research.medvault.com/msp/signcerts/cert.pem",
        keyDir:       "../organizations/peerOrganizations/research.medvault.com/users/Admin@research.medvault.com/msp/keystore",
    },
};

/**
 * Resolve the private key path from a keystore directory.
 * Keystore filenames are non-deterministic hashes ending in _sk.
 *
 * @param {string} keyDir
 * @returns {string} full path to the _sk file
 */
function resolveKeyPath(keyDir) {
    const files = fs.readdirSync(keyDir);
    const sk = files.find(f => f.endsWith("_sk"));
    if (!sk) throw new Error(`No _sk file found in ${keyDir}`);
    return path.join(keyDir, sk);
}

/**
 * Create and return a Fabric gateway contract handle for a given org.
 * Caller is responsible for closing gateway and client after use.
 *
 * @param {string} orgName - One of: hospital, pharmacy, laboratory, governance, research
 * @returns {{ gateway, client, contract }}
 */
export async function getContract(orgName = "hospital") {
    const cfg = ORG_CONFIGS[orgName];
    if (!cfg) throw new Error(`Unknown org: "${orgName}". Valid orgs: ${Object.keys(ORG_CONFIGS).join(", ")}`);

    const tlsCert = fs.readFileSync(cfg.tlsCertPath);
    const cert    = fs.readFileSync(cfg.certPath, "utf8");
    const keyPath = resolveKeyPath(cfg.keyDir);
    const key     = fs.readFileSync(keyPath, "utf8");

    const client = new grpc.Client(
        cfg.peerEndpoint,
        grpc.credentials.createSsl(tlsCert),
        { "grpc.ssl_target_name_override": cfg.peerHostname }
    );

    const gateway = connect({
        client,
        identity: {
            mspId:       cfg.mspId,
            credentials: Buffer.from(cert),
        },
        signer: signers.newPrivateKeySigner(
            crypto.createPrivateKey({ key, format: "pem" })
        ),
    });

    const contract = gateway.getNetwork("medchannel").getContract("medvault");

    return { gateway, client, contract };
}