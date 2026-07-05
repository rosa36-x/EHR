import express from "express";
import multer from "multer";
import { uploadFile, getFile } from "../services/ipfsService.js";
import { authenticate } from "../services/authMiddleware.js";
const router = express.Router();

const upload = multer({
    storage: multer.memoryStorage()
});

/**
 * These routes were previously unauthenticated — any caller could upload or
 * download raw IPFS content directly, bypassing every sensitivity/treatment-
 * relationship/permission check that the record-level routes (consultation,
 * prescription, labreport, referral) enforce before touching IPFS.
 *
 * `authenticate` here only proves the caller has a valid token — it does NOT
 * check whether they're allowed to see the specific document behind a CID,
 * because a raw CID carries no patient/record context to check against.
 * The real fix is architectural: stop exposing this router publicly and only
 * call uploadFile/getFile from ipfsService.js directly inside the other
 * services (consultationFabricService, prescriptionFabricService, etc.),
 * which already do — this route then becomes dead code you can remove, or
 * keep behind an admin-only role for ops/debugging use only.
 */
router.post("/upload", authenticate, upload.single("file"), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({
                success: false,
                message: "No file uploaded"
            });
        }

        const cid = await uploadFile(req.file.buffer);

        return res.json({
            success: true,
            cid
        });
    } catch (err) {
        console.error(err);

        return res.status(500).json({
            success: false,
            message: err.message
        });
    }

});
router.get("/download/:cid", authenticate, async (req, res) => {
    try {
        const fileBuffer = await getFile(req.params.cid);
        res.setHeader("Content-Type", "application/octet-stream");
        res.setHeader(
            "Content-Disposition",
            `attachment; filename="${req.params.cid}"`
        );


        return res.send(fileBuffer);
    } catch (err) {
        console.error(err);

        return res.status(500).json({
            success: false,
            message: err.message
        });
    }
});

export default router;
