import express from "express";
import multer from "multer";
import { uploadFile, getFile } from "../services/ipfsService.js";
const router = express.Router();

const upload = multer({
    storage: multer.memoryStorage()
});

router.post("/upload", upload.single("file"), async (req, res) => {
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
router.get("/download/:cid", async (req, res) => {
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