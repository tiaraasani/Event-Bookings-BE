import { Request, Response, NextFunction } from "express";
import {
  createEventService,
  getEventsService,
  getEventByIdService,
  updateEventService,
  deleteEventService,
  getMyOrganizedEventsService,
} from "./event.service.js";
import { ApiError } from "../../utils/api-error.js";

export const createEventController = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const files = req.files as
      | { [fieldname: string]: Express.Multer.File[] }
      | undefined;

    const imageFile = files?.image?.[0];

    const result = await createEventService(req.user!.id, req.body, imageFile);

    res.status(201).send({
      message: "Event created successfully",
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

export const getEventsController = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const result = await getEventsService();

    res.status(200).send({
      message: "Events retrieved successfully",
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

export const getEventByIdController = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const id = Number(req.params.id);

    if (!Number.isInteger(id) || id <= 0) {
      throw new ApiError("Invalid event ID", 400);
    }

    const result = await getEventByIdService(id);

    res.status(200).send({
      message: "Event retrieved successfully",
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

export const updateEventController = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const id = Number(req.params.id);

    if (!Number.isInteger(id) || id <= 0) {
      throw new ApiError("Invalid event ID", 400);
    }

    const result = await updateEventService(req.user!.id, id, req.body);

    res.status(200).send({
      message: "Event updated successfully",
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

export const deleteEventController = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const result = await deleteEventService(
      req.user!.id,
      Number(req.params.id),
    );

    res.status(200).send({
      message: "Event deleted successfully",
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

export const getMyOrganizedEventsController = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const result = await getMyOrganizedEventsService(req.user!.id);

    res.status(200).json({
      message: "Organized events retrieved successfully",
      data: result,
    });
  } catch (error) {
    next(error);
  }
};
