import { getContract } from "./fabricService.js";

export async function createPatient(patientData) {
    let gateway;

    try {
        console.log("\n==========================================");
        console.log(" FABRIC CREATE PATIENT (REAL)");
        console.log("==========================================\n");

        const { contract, gateway: gw, client } = await getContract();
        gateway = gw;
        console.log("AADHAAR VID:", patientData.aadhaarVID);
        console.log("AADHAAR TOKEN:", patientData.aadhaarToken);
        await contract.submitTransaction(
            "CreatePatient",
            patientData.patientID,
            patientData.fullName,
            patientData.dob,
            patientData.gender,
            patientData.aadhaarVID,
            patientData.aadhaarToken,
            patientData.phone,
            patientData.email,
            patientData.createdAt,
            patientData.updatedAt
        );

        await gateway.close();
        await client.close();

        return {
            status: "SUCCESS",
            patientID: patientData.patientID,
            aadhaarVID: patientData.aadhaarVID,
            aadhaarToken: patientData.aadhaarToken,
            message: "Patient successfully written to Fabric ledger"
        };

    } catch (err) {
        if (gateway) await gateway.close();

        console.error("Fabric submitTransaction failed:", err);

        return {
            status: "FAILED",
            message: err.message
        };
    }
}

export async function getPatient(patientID) {
    let gateway;

    try {
        const { contract, gateway: gw, client } = await getContract();
        gateway = gw;

        const result = await contract.evaluateTransaction(
            "GetPatient",
            patientID
        );

        const text = Buffer.from(result).toString("utf8");
        const data = JSON.parse(text);

        await gateway.close();
        await client.close();

        return {
            status: "SUCCESS",
            data
        };

    } catch (err) {
        if (gateway) await gateway.close();

        return {
            status: "FAILED",
            message: err.message
        };
    }
}