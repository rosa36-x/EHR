import express from "express";
import multer from "multer";
import * as svc from "../services/consultationFabricService.js";

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

/**
 * POST /consultations
 * Multipart form: file (PDF) + fields (consultationID, patientID, doctorID, diagnosis)
 */
router.post("/", upload.single("file"), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ status: "FAILED", message: "Consultation document (PDF) is required." });
    }

    const { consultationID, patientID, doctorID, diagnosis } = req.body;

    if (!consultationID || !patientID || !doctorID || !diagnosis) {
        return res.status(400).json({ status: "FAILED", message: "consultationID, patientID, doctorID, diagnosis are required." });
    }

    const result = await svc.createConsultation(
        { consultationID, patientID, doctorID, diagnosis },
        req.file.buffer
    );

    return res.status(result.status === "SUCCESS" ? 200 : 500).json(result);
});

/**
 * GET /consultations/:id
 * Returns consultation metadata from Fabric.
 */
router.get("/:id", async (req, res) => {
    const result = await svc.getConsultation(req.params.id);
    return res.status(result.status === "SUCCESS" ? 200 : 500).json(result);
});

/**
 * GET /consultations/:id/document
 * Returns decrypted consultation document from IPFS.
 */
router.get("/:id/document", async (req, res) => {
    const result = await svc.getConsultationDocument(req.params.id);

    if (result.status !== "SUCCESS") {
        return res.status(500).json(result);
    }

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${req.params.id}.pdf"`);
    return res.send(result.document);
});

/**
 * PUT /consultations/:id
 * Update consultation with a new document.
 * Multipart form: file (PDF) + fields (diagnosis)
 */
router.put("/:id", upload.single("file"), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ status: "FAILED", message: "Updated consultation document is required." });
    }

    const { diagnosis } = req.body;

    if (!diagnosis) {
        return res.status(400).json({ status: "FAILED", message: "diagnosis is required." });
    }

    const result = await svc.updateConsultation(
        { consultationID: req.params.id, diagnosis },
        req.file.buffer
    );

    return res.status(result.status === "SUCCESS" ? 200 : 500).json(result);
});

export default router;
