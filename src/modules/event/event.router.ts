import { Router } from "express";
import {
  createEventController,
  getEventsController,
  getEventByIdController,
  updateEventController,
  deleteEventController,
} from "./event.controller.js";
import { validate } from "../../middlewares/validate.js";
import { upload } from "../../middlewares/upload.js";
import { createEventSchema, updateEventSchema } from "./event.validation.js";
import type { Request, Response, NextFunction } from "express";

const router = Router();

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
  upload().fields([{ name: "image", maxCount: 1 }]),
  parseEventFormData,
  validate(createEventSchema),
  createEventController,
);

router.patch("/:id", validate(updateEventSchema), updateEventController);

router.delete("/:id", deleteEventController);

export default router;
