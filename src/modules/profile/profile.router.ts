import { Router } from "express";
import { authenticate } from "../../middlewares/auth";
import * as profileController from "./profile.controller";
import { validate } from "../../middlewares/validate";
import {
  updateProfileSchema,
  changePasswordSchema,
} from "./profile.validation";
import { fileFilter, upload } from "../../middlewares/upload";

const router = Router();
router.use(authenticate);

router.get("/", profileController.getProfile);
router.patch(
  "/",
  validate(updateProfileSchema),
  profileController.updateProfile,
);
router.patch(
  "/password",
  validate(changePasswordSchema),
  profileController.changePassword,
);
router.patch(
  "/picture",
  upload().fields([{ name: "picture", maxCount: 1 }]),
  fileFilter(["image/jpeg", "image/png", "image/webp", "image/avif"]),
  profileController.updatePicture,
);

export default router;
