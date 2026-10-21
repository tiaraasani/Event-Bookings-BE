import {
  createReviewService,
  getEventReviewsService,
  getOrganizerReviewsService,
} from "./review.service.js";
import type { Request, Response, NextFunction } from "express";

export const createReviewController = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const result = await createReviewService(req.user!.id, req.body);

    res.status(201).json({
      message: "Review created successfully",
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

export const getEventReviewsController = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const eventId = Number(req.params.eventId);

    if (!Number.isInteger(eventId) || eventId <= 0) {
      throw new Error("Invalid event ID");
    }

    const result = await getEventReviewsService(eventId);

    res.status(200).json({
      message: "Event reviews retrieved successfully",
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

export const getOrganizerReviewsController = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const organizationId = Number(req.params.organizationId);

    if (!Number.isInteger(organizationId) || organizationId <= 0) {
      throw new Error("Invalid organization ID");
    }

    const result = await getOrganizerReviewsService(organizationId);

    res.status(200).json({
      message: "Organizer reviews retrieved successfully",
      data: result,
    });
  } catch (error) {
    next(error);
  }
};
