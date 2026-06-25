import fs from "fs";

const certPath =
    "../organizations/peerOrganizations/hospital.medvault.com/users/doctor1@hospital.medvault.com/msp/signcerts/cert.pem";

const keyPath =
    "../organizations/peerOrganizations/hospital.medvault.com/users/doctor1@hospital.medvault.com/msp/keystore/e52955363eae729060ab3dc74eda95c9714c5f00bffae628dc13be9a86e401b7_sk";

const cert = fs.readFileSync(certPath, "utf8");
const key = fs.readFileSync(keyPath, "utf8");

const tlsCertPath =
    "../organizations/peerOrganizations/hospital.medvault.com/peers/peer0.hospital.medvault.com/tls/ca.crt";

const tlsCert = fs.readFileSync(tlsCertPath, "utf8");

console.log("TLS cert loaded:", tlsCert.length, "bytes");

console.log("Certificate loaded:", cert.length, "bytes");
console.log("Private key loaded:", key.length, "bytes");
