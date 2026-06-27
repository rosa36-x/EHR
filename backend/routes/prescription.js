import express from "express";
import multer from "multer";
import * as svc from "../services/prescriptionFabricService.js";

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

/**
 * POST /prescriptions
 * Multipart form: file (PDF) + fields (prescriptionID, patientID, doctorID, issuedAt?)
 */
router.post("/", upload.single("file"), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ status: "FAILED", message: "Prescription document (PDF) is required." });
    }

    const { prescriptionID, patientID, doctorID } = req.body;

    if (!prescriptionID || !patientID || !doctorID) {
        return res.status(400).json({
            status: "FAILED",
            message: "prescriptionID, patientID, doctorID are required.",
        });
    }

    const result = await svc.createPrescription(req.body, req.file.buffer);
    return res.status(result.status === "SUCCESS" ? 200 : 500).json(result);
});

/**
 * GET /prescriptions/:id
 * Query param: ?org=hospital|pharmacy (default: hospital)
 */
router.get("/:id", async (req, res) => {
    const org = req.query.org ?? "hospital";
    const result = await svc.getPrescription(req.params.id, org);
    return res.status(result.status === "SUCCESS" ? 200 : 500).json(result);
});

/**
 * GET /prescriptions/:id/document
 * Returns decrypted prescription PDF from IPFS.
 * Query param: ?org=hospital|pharmacy (default: hospital)
 */
router.get("/:id/document", async (req, res) => {
    const org = req.query.org ?? "hospital";
    const result = await svc.getPrescriptionDocument(req.params.id, org);

    if (result.status !== "SUCCESS") {
        return res.status(500).json(result);
    }

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${req.params.id}.pdf"`);
    return res.send(result.document);
});

/**
 * PATCH /prescriptions/:id/status
 * Body: { status, dispensedAt?, org? }
 */
router.patch("/:id/status", async (req, res) => {
    const { status, dispensedAt, org } = req.body;

    if (!status) {
        return res.status(400).json({ status: "FAILED", message: "status is required." });
    }

    const result = await svc.updatePrescriptionStatus(
        req.params.id,
        status,
        dispensedAt,
        org ?? "hospital"
    );

    return res.status(result.status === "SUCCESS" ? 200 : 500).json(result);
});

export default router;
