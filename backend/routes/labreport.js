import express from "express";
import multer from "multer";
import * as svc from "../services/labReportFabricService.js";

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

/**
 * POST /labreports
 * Multipart form: file (PDF) + fields (reportID, patientID, labTechID, reportType)
 */
router.post("/", upload.single("file"), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ status: "FAILED", message: "Lab report document (PDF) is required." });
    }

    const { reportID, patientID, labTechID, reportType } = req.body;

    if (!reportID || !patientID || !labTechID || !reportType) {
        return res.status(400).json({
            status: "FAILED",
            message: "reportID, patientID, labTechID, reportType are required.",
        });
    }

    const result = await svc.createLabReport(req.body, req.file.buffer);
    return res.status(result.status === "SUCCESS" ? 200 : 500).json(result);
});

/**
 * GET /labreports/:id
 * Query param: ?org=laboratory|hospital (default: laboratory)
 */
router.get("/:id", async (req, res) => {
    const org = req.query.org ?? "laboratory";
    const result = await svc.getLabReport(req.params.id, org);
    return res.status(result.status === "SUCCESS" ? 200 : 500).json(result);
});

/**
 * GET /labreports/:id/document
 * Returns decrypted lab report PDF from IPFS.
 * Query param: ?org=laboratory|hospital (default: laboratory)
 */
router.get("/:id/document", async (req, res) => {
    const org = req.query.org ?? "laboratory";
    const result = await svc.getLabReportDocument(req.params.id, org);

    if (result.status !== "SUCCESS") {
        return res.status(500).json(result);
    }

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${req.params.id}.pdf"`);
    return res.send(result.document);
});

/**
 * PUT /labreports/:id
 * Update lab report with new document.
 * Multipart form: file (PDF) + fields (reportType, status?)
 */
router.put("/:id", upload.single("file"), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ status: "FAILED", message: "Updated lab report document is required." });
    }

    const { reportType, status } = req.body;

    if (!reportType) {
        return res.status(400).json({ status: "FAILED", message: "reportType is required." });
    }

    const result = await svc.updateLabReport(
        { reportID: req.params.id, reportType, status },
        req.file.buffer
    );

    return res.status(result.status === "SUCCESS" ? 200 : 500).json(result);
});

export default router;
