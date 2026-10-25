import { prisma } from "../../lib/prisma.js";
import { ApiError } from "../../utils/api-error.js";
import type { CreateReviewSchema } from "./review.validation.js";

export const createReviewService = async (
  userId: number,
  data: CreateReviewSchema,
) => {
  const event = await prisma.event.findFirst({
    where: {
      id: data.eventId,
      deletedAt: null,
    },
  });

  if (!event) {
    throw new ApiError("Event not found", 404);
  }

  if (event.endDate >= new Date()) {
    throw new ApiError("You can only review an event after it has ended", 400);
  }

  const eligibleOrder = await prisma.order.findFirst({
    where: {
      userId,
      paymentStatus: "PAID",
      ticket: {
        eventId: data.eventId,
      },
    },
    select: {
      id: true,
    },
  });

  if (!eligibleOrder) {
    throw new ApiError(
      "You must purchase and pay for a ticket to review this event",
      403,
    );
  }

  const existingReview = await prisma.review.findUnique({
    where: {
      orderId_type: {
        orderId: eligibleOrder.id,
        type: data.type,
      },
    },
  });

  if (existingReview) {
    throw new ApiError(
      "You have already submitted this type of review for this order",
      409,
    );
  }

  const review = await prisma.review.create({
    data: {
      orderId: eligibleOrder.id,
      type: data.type,
      rating: data.rating,
      title: data.title,
      comment: data.comment,
    },
  });

  return review;
};

export const getEventReviewsService = async (eventId: number) => {
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: { id: true },
  });

  if (!event) {
    throw new ApiError("Event not found", 404);
  }

  return prisma.review.findMany({
    where: {
      type: "EVENT",
      order: {
        ticket: {
          eventId,
        },
      },
    },
    include: {
      order: {
        select: {
          user: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      },
    },
    orderBy: {
      createdAt: "desc",
    },
  });
};

export const getOrganizationReviewsService = async (organizationId: number) => {
  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { id: true },
  });

  if (!organization) {
    throw new ApiError("Organization not found", 404);
  }

  return prisma.review.findMany({
    where: {
      type: "ORGANIZER",
      order: {
        ticket: {
          event: {
            organizationId,
          },
        },
      },
    },
    include: {
      order: {
        select: {
          user: {
            select: {
              id: true,
              name: true,
            },
          },
          ticket: {
            select: {
              event: {
                select: {
                  id: true,
                  name: true,
                },
              },
            },
          },
        },
      },
    },
    orderBy: {
      createdAt: "desc",
    },
  });
};
