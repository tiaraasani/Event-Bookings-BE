import { Router } from "express";
import * as authController from "./auth.controller";
import { authenticate, verifyToken } from "../../middlewares/auth";
import { validate } from "../../middlewares/validate";
import {
  registerSchema,
  loginSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
} from "./auth.validation";

const router = Router();

router.post("/register", validate(registerSchema), authController.register);
router.post("/login", validate(loginSchema), authController.login);
router.get("/me", authenticate, authController.me);
router.post(
  "/forgot-password",
  validate(forgotPasswordSchema),
  authController.forgotPassword,
);
router.post(
  "/reset-password",
  verifyToken("JWT_SECRET_RESET"),
  validate(resetPasswordSchema),
  authController.resetPassword,
);

export default router;
