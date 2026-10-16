import { Router } from "express";
import { authenticate, authorize } from "../../middlewares/auth";
import { Role } from "../../generated/prisma/client";
import { validate } from "../../middlewares/validate";
import { createTransactionSchema } from "./transaction.validation";
import {
  createTransactionController,
  getMyPointBalanceController,
  getMyTransactionsController,
} from "./transaction.controller";
import { uploadPaymentProofController } from "./transaction.controller";
import { upload } from "../../middlewares/upload";

const router = Router();

router.post(
  "/",
  authenticate,
  authorize(Role.CUSTOMER),
  validate(createTransactionSchema),
  createTransactionController,
);

router.post(
  "/:id/payment-proof",
  authenticate,
  authorize(Role.CUSTOMER),
  upload().fields([{ name: "image", maxCount: 1 }]),
  uploadPaymentProofController,
);

router.get(
  "/my",
  authenticate,
  authorize(Role.CUSTOMER),
  getMyTransactionsController,
);

router.get(
  "/my/points",
  authenticate,
  authorize(Role.CUSTOMER),
  getMyPointBalanceController,
);

export default router;
