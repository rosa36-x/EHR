import express from "express";
import cors from "cors";

import { connectDB } from "./services/db.js";
import { registerShutdownHandlers } from "./services/ipfsService.js";

// ── Routes ────────────────────────────────────────────────────────────────────
import uidaiRoutes              from "./routes/uidai.js";
import patientRoutes            from "./routes/patient.js";
import ipfsRoutes               from "./routes/ipfs.js";
import authRoutes               from "./routes/auth.js";
import doctorRoutes             from "./routes/doctor.js";
import consultationRoutes       from "./routes/consultation.js";
import referralRoutes           from "./routes/referral.js";
import consentRoutes            from "./routes/consent.js";
import prescriptionRoutes       from "./routes/prescription.js";
import labReportRoutes          from "./routes/labreport.js";
import auditRoutes              from "./routes/audit.js";
import emergencyRoutes          from "./routes/emergency.js";
import permissionRequestRoutes  from "./routes/permissionRequest.js";
import treatmentRelationshipRoutes from "./routes/treatmentRelationship.js";
import auditHistoryRoutes       from "./routes/auditHistory.js";

const app = express();

app.use(cors());
app.use(express.json());

// ── Mount Routes ──────────────────────────────────────────────────────────────
app.use("/uidai",                  uidaiRoutes);
app.use("/auth",                   authRoutes);
app.use("/doctors",                doctorRoutes);
app.use("/patients",               patientRoutes);
app.use("/ipfs",                   ipfsRoutes);
app.use("/consultations",          consultationRoutes);
app.use("/referrals",              referralRoutes);
app.use("/consents",               consentRoutes);
app.use("/prescriptions",          prescriptionRoutes);
app.use("/labreports",             labReportRoutes);
app.use("/audits",                 auditRoutes);
app.use("/emergency-access",       emergencyRoutes);
app.use("/permission-requests",    permissionRequestRoutes);
app.use("/treatment-relationships",treatmentRelationshipRoutes);
app.use("/audit-history",          auditHistoryRoutes);

// ── Startup ───────────────────────────────────────────────────────────────────
const PORT = process.env.PORT ?? 5000;

async function start() {
    await connectDB();
    registerShutdownHandlers();

    app.listen(PORT, () => {
        console.log(`MedVault backend running on port ${PORT}`);
    });
}

start();
