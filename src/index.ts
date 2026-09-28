import express from "express";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 8000;

app.use(cors());
app.use(express.json());

app.get("/", (_req, res) => {
  res.json({ message: "API running" });
});

app.listen(PORT, () => {
  console.log(`Server on http://localhost:${PORT}`);
});
