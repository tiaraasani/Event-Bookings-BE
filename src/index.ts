import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import dotenv from "dotenv";
import authRouter from "./modules/auth/auth.router";
import profileRouter from "./modules/profile/profile.router"
import { globalError, notFoundError } from "./utils/errors";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 8000;

app.use(cors());
app.use(express.json());
app.use("/api/auth", authRouter);
app.use("/api/profile", profileRouter)

app.get("/", (_req, res) => {
  res.json({ message: "API running" });
});

app.use(notFoundError);
app.use(globalError);

app.listen(PORT, () => {
  console.log(`Server on http://localhost:${PORT}`);
});
