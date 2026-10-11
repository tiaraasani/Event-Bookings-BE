import { Router } from "express";
import {
  createEventController,
  getEventsController,
  getEventByIdController,
  updateEventController,
  deleteEventController,
} from "./event.controller.js";
import { validate } from "../../middlewares/validate.js";
import { createEventSchema, updateEventSchema } from "./event.validation.js";

const router = Router();

router.get("/", getEventsController);
router.get("/:id", getEventByIdController);

router.post("/", validate(createEventSchema), createEventController);

router.patch("/:id", validate(updateEventSchema), updateEventController);

router.delete("/:id", deleteEventController);

export default router;
