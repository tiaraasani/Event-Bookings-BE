import { Router } from "express";
import {
  createReviewController,
  getEventReviewsController,
  getOrganizationReviewsController,
} from "./review.controller.js";
import { validate } from "../../middlewares/validate.js";
import { authenticate } from "../../middlewares/auth.js";
import { createReviewSchema } from "./review.validation.js";

const router = Router();

router.get("/event/:eventId", getEventReviewsController);

router.get("/organization/:organizationId", getOrganizationReviewsController);

router.post(
  "/",
  authenticate,
  validate(createReviewSchema),
  createReviewController,
);

export default router;
