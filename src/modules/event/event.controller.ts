import { Request, Response, NextFunction } from "express";
import {
  createEventService,
  getEventsService,
  getEventByIdService,
  updateEventService,
  deleteEventService,
} from "./event.service.js";

export const createEventController = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const result = await createEventService(req.body);

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
    const result = await updateEventService(id, req.body);

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
    const id = Number(req.params.id);

    const result = await deleteEventService(id);

    res.status(200).send(result);
  } catch (error) {
    next(error);
  }
};
