import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import authRouter from "./modules/auth/auth.router";
import profileRouter from "./modules/profile/profile.router";
import { globalError, notFoundError } from "./utils/errors";
import eventRouter from "./modules/event/event.router";
import transactionRouter from "./modules/transaction/transaction.router";
import organizerRouter from "./modules/organizer/organizer.router";
import reviewRoutes from "./modules/review/review.router.js";
import { expiredTransactionCron } from "./script/transaction.js";
import voucherRoutes from "./modules/voucher/voucher.router.js";

dotenv.config();

console.log("DATABASE_URL loaded:", !!process.env.DATABASE_URL);
console.log("JWT_SECRET loaded:", !!process.env.JWT_SECRET);
console.log("PORT:", process.env.PORT);

const app = express();
const PORT = process.env.PORT || 8000;

app.use(
  cors({
    origin: "http://localhost:5173",
    credentials: true,
  }),
);
app.use(express.json());

app.use("/api/auth", authRouter);
app.use("/api/profile", profileRouter);
app.use("/api/events", eventRouter);
app.use("/api/transactions", transactionRouter);
app.use("/api/organizer", organizerRouter);
app.use("/api/reviews", reviewRoutes);
app.use("/api/vouchers", voucherRoutes);

expiredTransactionCron();

app.get("/", (_req, res) => {
  res.json({ message: "API running" });
});

app.use(notFoundError);
app.use(globalError);

app.listen(PORT, () => {
  console.log(`Server on http://localhost:${PORT}`);
});
