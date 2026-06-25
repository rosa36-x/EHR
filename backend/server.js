import express from "express";
import cors from "cors";

import uidaiRoutes from "./routes/uidai.js";
//import patientRoutes from "./routes/patient.js";
import ipfsRoutes from "./routes/ipfs.js";
import { registerShutdownHandlers } from "./services/ipfsService.js";

const app = express();

app.use(cors());
app.use("/ipfs", ipfsRoutes);
app.use(express.json());

app.use("/uidai", uidaiRoutes);
//app.use("/patients", patientRoutes);

// Register Helia cleanup handlers
registerShutdownHandlers();

const PORT = 5000;

app.listen(PORT, () => {
    console.log(`UIDAI Mock Service running on port ${PORT}`);
});