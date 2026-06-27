import express from "express";
import cors from "cors";

import uidaiRoutes        from "./routes/uidai.js";
import patientRoutes      from "./routes/patient.js";
import ipfsRoutes         from "./routes/ipfs.js";
import consultationRoutes from "./routes/consultation.js";
import referralRoutes     from "./routes/referral.js";
import consentRoutes      from "./routes/consent.js";
import prescriptionRoutes from "./routes/prescription.js";
import labReportRoutes    from "./routes/labreport.js";
import auditRoutes        from "./routes/audit.js";
import emergencyRoutes    from "./routes/emergency.js";

import { registerShutdownHandlers } from "./services/ipfsService.js";

const app = express();

app.use(cors());
app.use(express.json());

// ── Routes ────────────────────────────────────────────────────────────────────
app.use("/uidai",            uidaiRoutes);
app.use("/patients",         patientRoutes);
app.use("/ipfs",             ipfsRoutes);
app.use("/consultations",    consultationRoutes);
app.use("/referrals",        referralRoutes);
app.use("/consents",         consentRoutes);
app.use("/prescriptions",    prescriptionRoutes);
app.use("/labreports",       labReportRoutes);
app.use("/audits",           auditRoutes);
app.use("/emergency-access", emergencyRoutes);

// ── IPFS / Helia shutdown ─────────────────────────────────────────────────────
registerShutdownHandlers();

// ── Start ─────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT ?? 5000;

app.listen(PORT, () => {
    console.log(`MedVault backend running on port ${PORT}`);
});
