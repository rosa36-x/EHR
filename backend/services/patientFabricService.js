/**
 * Patient Fabric Service
 *
 * NOTE:
 * This is currently a mock implementation.
 *
 * Once gateway.js is completed,
 * replace the TODO section with:
 *
 * const contract = await getContract();
 * await contract.submitTransaction("CreatePatient", ...);
 */

export async function createPatient(patientData) {

    console.log("\n==========================================");
    console.log(" FABRIC CREATE PATIENT (MOCK)");
    console.log("==========================================\n");

    console.table(patientData);

    // -------------------------------------------------
    // TODO:
    //
    // const contract = await getContract();
    //
    // await contract.submitTransaction(
    //     "CreatePatient",
    //     patientData.patientID,
    //     patientData.fullName,
    //     patientData.dob,
    //     patientData.gender,
    //     patientData.aadhaarVID,
    //     patientData.aadhaarToken,
    //     patientData.phone,
    //     patientData.email,
    //     patientData.createdAt,
    //     patientData.updatedAt
    // );
    //
    // -------------------------------------------------

    return {

        status: "SUCCESS",

        patientID: patientData.patientID,

        aadhaarVID: patientData.aadhaarVID,

        aadhaarToken: patientData.aadhaarToken,

        message: "Patient successfully prepared for Fabric submission."

    };

}