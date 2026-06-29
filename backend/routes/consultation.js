import express from "express";
import multer from "multer";
import * as svc from "../services/consultationFabricService.js";
import { authenticate } from "../services/authMiddleware.js";

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

/**
 * POST /consultations
 * Multipart form: file (PDF) + fields (consultationID, patientID, doctorID, diagnosis, recordType)
 */
router.post("/", authenticate, upload.single("file"), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ status: "FAILED", message: "Consultation document (PDF) is required." });
    }

    const { consultationID, patientID, doctorID, diagnosis, recordType } = req.body;

    if (!consultationID || !patientID || !doctorID || !diagnosis || !recordType) {
        return res.status(400).json({ status: "FAILED", message: "consultationID, patientID, doctorID, diagnosis, recordType are required." });
    }

    const result = await svc.createConsultation(
        { consultationID, patientID, doctorID, diagnosis, recordType },
        req.file.buffer,
        req.user.id
    );

    return res.status(result.status === "SUCCESS" ? 200 : 500).json(result);
});

/**
 * GET /consultations/:id
 */
router.get("/:id", authenticate, async (req, res) => {
    const result = await svc.getConsultation(req.params.id, req.user.id, req.user.role);
    return res.status(result.status === "SUCCESS" ? 200 : 500).json(result);
});

/**
 * GET /consultations/:id/document
 */
router.get("/:id/document", authenticate, async (req, res) => {
    const result = await svc.getConsultationDocument(req.params.id, req.user.id, req.user.role);

    if (result.status !== "SUCCESS") {
        return res.status(result.status === "ACCESS_DENIED" ? 403 : 500).json(result);
    }

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${req.params.id}.pdf"`);
    return res.send(result.document);
});

/**
 * PUT /consultations/:id
 */
router.put("/:id", authenticate, upload.single("file"), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ status: "FAILED", message: "Updated consultation document is required." });
    }

    const { diagnosis } = req.body;

    if (!diagnosis) {
        return res.status(400).json({ status: "FAILED", message: "diagnosis is required." });
    }

    const result = await svc.updateConsultation(
        { consultationID: req.params.id, diagnosis },
        req.file.buffer,
        req.user.id
    );

    return res.status(result.status === "SUCCESS" ? 200 : 500).json(result);
});

export default router;
