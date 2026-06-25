import fs from "fs";
import crypto from "crypto";
import * as grpc from "@grpc/grpc-js";
import pkg from "@hyperledger/fabric-gateway";

const { connect, signers } = pkg;

// Paths
const tlsCertPath =
  "../organizations/peerOrganizations/hospital.medvault.com/peers/peer0.hospital.medvault.com/tls/ca.crt";

const certPath =
  "../organizations/peerOrganizations/hospital.medvault.com/users/doctor1@hospital.medvault.com/msp/signcerts/cert.pem";

const keyPath =
  "../organizations/peerOrganizations/hospital.medvault.com/users/doctor1@hospital.medvault.com/msp/keystore/e52955363eae729060ab3dc74eda95c9714c5f00bffae628dc13be9a86e401b7_sk";

const tlsCert = fs.readFileSync(tlsCertPath);
const cert = fs.readFileSync(certPath, "utf8");
const key = fs.readFileSync(keyPath, "utf8");

function createGrpc() {
  return new grpc.Client(
    "localhost:7051",
    grpc.credentials.createSsl(tlsCert),
    {
      "grpc.ssl_target_name_override": "peer0.hospital.medvault.com",
    }
  );
}

export async function getContract() {
  const client = createGrpc();

  const identity = {
    mspId: "HospitalMSP",
    credentials: Buffer.from(cert),
  };

  const privateKey = crypto.createPrivateKey({
    key,
    format: "pem",
  });

  const signer = signers.newPrivateKeySigner(privateKey);

  const gateway = connect({
    client,
    identity,
    signer,
  });

  const network = gateway.getNetwork("medchannel");
  const contract = network.getContract("medvault");

  return { gateway, client, contract };
}