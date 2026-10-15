import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
import {
  createEventController,
  getEventsController,
  getEventByIdController,
  updateEventController,
  deleteEventController,
} from "./event.controller.js";
import { validate } from "../../middlewares/validate.js";
import { authenticate } from "../../middlewares/auth.js";
import { upload } from "../../middlewares/upload.js";
import { createEventSchema, updateEventSchema } from "./event.validation.js";

const router = Router();

const requireOrganizer = (req: Request, res: Response, next: NextFunction) => {
  if (req.user?.role !== "ORGANIZER") {
    return res.status(403).json({
      message: "Only organizers can manage events",
    });
  }

  next();
};

const parseEventFormData = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    if (typeof req.body.data === "string") {
      req.body = JSON.parse(req.body.data);
    }

    next();
  } catch {
    res.status(400).send({ message: "Invalid event form data" });
  }
};

router.get("/", getEventsController);
router.get("/:id", getEventByIdController);

router.post(
  "/",
  authenticate,
  requireOrganizer,
  upload().fields([{ name: "image", maxCount: 1 }]),
  parseEventFormData,
  validate(createEventSchema),
  createEventController,
);

router.patch(
  "/:id",
  authenticate,
  requireOrganizer,
  validate(updateEventSchema),
  updateEventController,
);

router.delete("/:id", authenticate, requireOrganizer, deleteEventController);

export default router;
