const express = require("express");
const cors = require("cors");

const uidaiRoutes = require("./routes/uidai");

const app = express();

app.use(cors());
app.use(express.json());

app.use("/uidai", uidaiRoutes);

const PORT = 5000;

app.listen(PORT, () => {
    console.log(`UIDAI Mock Service running on port ${PORT}`);
});
