import { Router } from "express";
import * as authController from "./auth.controller";
import { authenticate } from "../../middlewares/auth";

const router = Router();

router.post("/register", authController.register);
router.post("/login", authController.login);
router.get("/me", authenticate, authController.me);

export default router;