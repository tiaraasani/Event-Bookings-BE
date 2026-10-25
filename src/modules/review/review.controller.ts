import type { Request, Response, NextFunction } from "express";
import { ApiError } from "../../utils/api-error.js";
import {
  createReviewService,
  getEventReviewsService,
  getOrganizationReviewsService,
} from "./review.service.js";
import { createReviewSchema } from "./review.validation.js";

export const createReviewController = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const parsed = createReviewSchema.safeParse(req.body);

    if (!parsed.success) {
      throw new ApiError(
        parsed.error.issues[0]?.message || "Invalid review data",
        400,
      );
    }

    const result = await createReviewService(req.user!.id, parsed.data);

    res.status(201).send({
      message: "Review submitted successfully",
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
      throw new ApiError("Invalid event ID", 400);
    }

    const result = await getEventReviewsService(eventId);

    res.status(200).send({
      message: "Event reviews retrieved successfully",
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

export const getOrganizationReviewsController = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const organizationId = Number(req.params.organizationId);

    if (!Number.isInteger(organizationId) || organizationId <= 0) {
      throw new ApiError("Invalid organization ID", 400);
    }

    const result = await getOrganizationReviewsService(organizationId);

    res.status(200).send({
      message: "Organizer reviews retrieved successfully",
      data: result,
    });
  } catch (error) {
    next(error);
  }
};
