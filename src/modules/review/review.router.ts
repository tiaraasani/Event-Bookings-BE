import { Router } from "express";
import { Role } from "../../generated/prisma/client";
import { authenticate, authorize } from "../../middlewares/auth.js";
import { validate } from "../../middlewares/validate.js";
import {
  createReviewController,
  getEventReviewsController,
  getOrganizerReviewsController,
} from "./review.controller.js";
import { createReviewSchema } from "./review.validation.js";

const router = Router();

router.post(
  "/",
  authenticate,
  authorize(Role.CUSTOMER),
  validate(createReviewSchema),
  createReviewController,
);

router.get("/event/:eventId", getEventReviewsController);
router.get("/organizer/:organizationId", getOrganizerReviewsController);
export default router;
