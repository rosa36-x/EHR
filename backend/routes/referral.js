import express from "express";
import multer from "multer";
import * as svc from "../services/referralFabricService.js";

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

/**
 * POST /referrals
 * Multipart form: file (PDF) + fields (referralID, patientID, fromDoctorID, toDoctorID, referralReason)
 */
router.post("/", upload.single("file"), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ status: "FAILED", message: "Referral document (PDF) is required." });
    }

    const { referralID, patientID, fromDoctorID, toDoctorID, referralReason } = req.body;

    if (!referralID || !patientID || !fromDoctorID || !toDoctorID || !referralReason) {
        return res.status(400).json({
            status: "FAILED",
            message: "referralID, patientID, fromDoctorID, toDoctorID, referralReason are required.",
        });
    }

    const result = await svc.createReferral(
        { referralID, patientID, fromDoctorID, toDoctorID, referralReason },
        req.file.buffer
    );

    return res.status(result.status === "SUCCESS" ? 200 : 500).json(result);
});

/**
 * GET /referrals/:id
 * Returns referral metadata from Fabric.
 */
router.get("/:id", async (req, res) => {
    const result = await svc.getReferral(req.params.id);
    return res.status(result.status === "SUCCESS" ? 200 : 500).json(result);
});

/**
 * GET /referrals/:id/document
 * Returns decrypted referral document from IPFS.
 */
router.get("/:id/document", async (req, res) => {
    const result = await svc.getReferralDocument(req.params.id);

    if (result.status !== "SUCCESS") {
        return res.status(500).json(result);
    }

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${req.params.id}.pdf"`);
    return res.send(result.document);
});

export default router;
