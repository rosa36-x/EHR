import fs from "fs";
import * as grpc from "@grpc/grpc-js";
import crypto from "crypto";
import pkg from "@hyperledger/fabric-gateway";

const { connect, signers } = pkg;

// ---------------- CONFIG ----------------
const peerEndpoint = "localhost:7051";

const tlsCertPath =
    "../organizations/peerOrganizations/hospital.medvault.com/peers/peer0.hospital.medvault.com/tls/ca.crt";

const certPath =
    "../organizations/peerOrganizations/hospital.medvault.com/users/doctor1@hospital.medvault.com/msp/signcerts/cert.pem";

const keyPath =
    "../organizations/peerOrganizations/hospital.medvault.com/users/doctor1@hospital.medvault.com/msp/keystore/e52955363eae729060ab3dc74eda95c9714c5f00bffae628dc13be9a86e401b7_sk";

// ---------------- LOAD FILES ----------------
const tlsCert = fs.readFileSync(tlsCertPath);
const cert = fs.readFileSync(certPath, "utf8");
const key = fs.readFileSync(keyPath, "utf8");

// ---------------- GRPC CONNECTION ----------------
function createGrpcConnection() {
    return new grpc.Client(
        peerEndpoint,
        grpc.credentials.createSsl(tlsCert),
        {
            "grpc.ssl_target_name_override": "peer0.hospital.medvault.com",
        }
    );
}

// ---------------- MAIN ----------------
async function main() {
    const client = createGrpcConnection();

    const identity = {
        mspId: "HospitalMSP",
        credentials: Buffer.from(cert),
    };

    const privateKey = crypto.createPrivateKey({
        key: key,
        format: "pem",
    });

    const signer = signers.newPrivateKeySigner(privateKey);

    const gateway = connect({
        client,
        identity,
        signer,
    });

    // ---------------- NETWORK ACCESS ----------------
    const network = gateway.getNetwork("medchannel");
    const contract = network.getContract("medvault");

    console.log("Connected to network + contract");

    // ---------------- TEST QUERY ----------------
    const result = await contract.evaluateTransaction(
        "GetPatient",
        "P001"
    );
    console.log("Chaincode response:");

    // Step 1: convert buffer → string
    const text = Buffer.from(result).toString("utf8");

    console.log("RAW STRING:");
    console.log(text);

    // Step 2: parse JSON safely
    const data = JSON.parse(text);

    console.log("\nPARSED:");
    console.log(data);

    // cleanup
    gateway.close();
    client.close();
}

main().catch((err) => {
    console.error("Gateway failed:", err);
});
