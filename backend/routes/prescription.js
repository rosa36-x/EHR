import express from "express";
import multer from "multer";
import * as svc from "../services/prescriptionFabricService.js";
import { authenticate, enforceOrgMatchesRole } from "../services/authMiddleware.js";

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

/**
 * POST /prescriptions
 * Multipart form: file (PDF) + fields (prescriptionID, patientID, doctorID, recordType, issuedAt?)
 */
router.post("/", authenticate, upload.single("file"), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ status: "FAILED", message: "Prescription document (PDF) is required." });
    }

    const { prescriptionID, patientID, doctorID, recordType } = req.body;

    if (!prescriptionID || !patientID || !doctorID || !recordType) {
        return res.status(400).json({
            status: "FAILED",
            message: "prescriptionID, patientID, doctorID, recordType are required.",
        });
    }

    const result = await svc.createPrescription(req.body, req.file.buffer, req.user.id);
    return res.status(result.status === "SUCCESS" ? 200 : 500).json(result);
});

/**
 * GET /prescriptions/:id
 * Query param: ?org=hospital|pharmacy (default: hospital)
 */
router.get("/:id", authenticate, enforceOrgMatchesRole, async (req, res) => {
    const org = req.query.org ?? "hospital";
    const result = await svc.getPrescription(req.params.id, req.user.id, req.user.role, org);
    const statusCode = result.status === "SUCCESS" ? 200 : result.status === "ACCESS_DENIED" ? 403 : 500;
    return res.status(statusCode).json(result);
});

/**
 * GET /prescriptions/:id/document
 * Query param: ?org=hospital|pharmacy (default: hospital)
 */
router.get("/:id/document", authenticate, enforceOrgMatchesRole, async (req, res) => {
    const org = req.query.org ?? "hospital";
    const result = await svc.getPrescriptionDocument(req.params.id, req.user.id, req.user.role, org);

    if (result.status !== "SUCCESS") {
        return res.status(result.status === "ACCESS_DENIED" ? 403 : 500).json(result);
    }

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${req.params.id}.pdf"`);
    return res.send(result.document);
});

/**
 * PATCH /prescriptions/:id/status
 * Body: { status, dispensedAt?, org? }
 */
router.patch("/:id/status", authenticate, enforceOrgMatchesRole, async (req, res) => {
    const { status, dispensedAt, org } = req.body;

    if (!status) {
        return res.status(400).json({ status: "FAILED", message: "status is required." });
    }

    const result = await svc.updatePrescriptionStatus(
        req.params.id,
        status,
        dispensedAt,
        req.user.id,
        req.user.role,
        org ?? "hospital"
    );

    const statusCode = result.status === "SUCCESS" ? 200 : result.status === "ACCESS_DENIED" ? 403 : 500;
    return res.status(statusCode).json(result);
});
/**
 * GET /prescriptions?patientID=...
 * Hospital-only (matches the chaincode-level restriction) — Pharmacy must
 * look up a specific prescription by ID, which goes through consent.
 */
router.get("/", authenticate, async (req, res) => {
    if (req.user.role === "org_actor") {
        return res.status(403).json({ status: "ACCESS_DENIED", message: "Pharmacy must look up a specific prescription by ID." });
    }
    const { patientID } = req.query;
    if (!patientID) {
        return res.status(400).json({ status: "FAILED", message: "patientID query param is required." });
    }
    const result = await svc.getPrescriptionsByPatient(patientID, req.user.id, req.user.role);
    return res.status(result.status === "SUCCESS" ? 200 : result.status === "ACCESS_DENIED" ? 403 : 500).json(result);
});

export default router;
