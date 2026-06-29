import express from "express";
import multer from "multer";
import * as svc from "../services/labReportFabricService.js";
import { authenticate } from "../services/authMiddleware.js";

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

/**
 * POST /labreports
 * Multipart form: file (PDF) + fields (reportID, patientID, labTechID, reportType)
 */
router.post("/", authenticate, upload.single("file"), async (req, res) => {
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

    const result = await svc.createLabReport(req.body, req.file.buffer, req.user.id);
    return res.status(result.status === "SUCCESS" ? 200 : 500).json(result);
});

/**
 * GET /labreports/:id
 * Query param: ?org=laboratory|hospital (default: laboratory)
 */
router.get("/:id", authenticate, async (req, res) => {
    const org = req.query.org ?? "laboratory";
    const result = await svc.getLabReport(req.params.id, req.user.id, req.user.role, org);
    return res.status(result.status === "SUCCESS" ? 200 : 500).json(result);
});

/**
 * GET /labreports/:id/document
 * Query param: ?org=laboratory|hospital (default: laboratory)
 */
router.get("/:id/document", authenticate, async (req, res) => {
    const org = req.query.org ?? "laboratory";
    const result = await svc.getLabReportDocument(req.params.id, req.user.id, req.user.role, org);

    if (result.status !== "SUCCESS") {
        return res.status(result.status === "ACCESS_DENIED" ? 403 : 500).json(result);
    }

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${req.params.id}.pdf"`);
    return res.send(result.document);
});

/**
 * PUT /labreports/:id
 * Multipart form: file (PDF) + fields (reportType, status?)
 */
router.put("/:id", authenticate, upload.single("file"), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ status: "FAILED", message: "Updated lab report document is required." });
    }

    const { reportType, status } = req.body;

    if (!reportType) {
        return res.status(400).json({ status: "FAILED", message: "reportType is required." });
    }

    const result = await svc.updateLabReport(
        { reportID: req.params.id, reportType, status },
        req.file.buffer,
        req.user.id
    );

    return res.status(result.status === "SUCCESS" ? 200 : 500).json(result);
});

export default router;
