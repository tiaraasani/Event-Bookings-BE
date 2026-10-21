import { prisma } from "../../lib/prisma.js";
import { ApiError } from "../../utils/api-error.js";
import type { CreateReviewSchema } from "./review.validation.js";

export const createReviewService = async (
  userId: number,
  data: CreateReviewSchema,
) => {
  const order = await prisma.order.findUnique({
    where: {
      id: data.orderId,
    },
    include: {
      ticket: {
        include: {
          event: true,
        },
      },
    },
  });

  if (!order) {
    throw new ApiError("Order not found", 404);
  }

  if (order.userId !== userId) {
    throw new ApiError("You are not allowed to review this order", 403);
  }

  if (order.paymentStatus !== "PAID") {
    throw new ApiError("Only paid orders can be reviewed", 400);
  }

  if (order.ticket.event.endDate > new Date()) {
    throw new ApiError("You can only review after the event has ended", 400);
  }

  const existingReview = await prisma.review.findUnique({
    where: {
      orderId_type: {
        orderId: data.orderId,
        type: data.type,
      },
    },
  });

  if (existingReview) {
    throw new ApiError(
      `You have already submitted an ${data.type.toLowerCase()} review for this order`,
      409,
    );
  }

  return prisma.review.create({
    data: {
      orderId: data.orderId,
      type: data.type,
      rating: data.rating,
      title: data.title,
      comment: data.comment,
    },
  });
};

export const getEventReviewsService = async (eventId: number) => {
  const event = await prisma.event.findFirst({
    where: {
      id: eventId,
      deletedAt: null,
    },
  });

  if (!event) {
    throw new ApiError("Event not found", 404);
  }

  const reviews = await prisma.review.findMany({
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
        include: {
          user: {
            select: {
              id: true,
              name: true,
              picture: true,
            },
          },
        },
      },
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  const totalReviews = reviews.length;

  const averageRating =
    totalReviews === 0
      ? 0
      : reviews.reduce((total, review) => total + review.rating, 0) /
        totalReviews;

  return {
    averageRating: Number(averageRating.toFixed(1)),
    totalReviews,
    reviews: reviews.map((review) => ({
      id: review.id,
      rating: review.rating,
      title: review.title,
      comment: review.comment,
      createdAt: review.createdAt,
      user: review.order.user,
    })),
  };
};

export const getOrganizerReviewsService = async (organizationId: number) => {
  const organization = await prisma.organization.findUnique({
    where: {
      id: organizationId,
    },
  });

  if (!organization) {
    throw new ApiError("Organization not found", 404);
  }

  const reviews = await prisma.review.findMany({
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
        include: {
          user: {
            select: {
              id: true,
              name: true,
              picture: true,
            },
          },
          ticket: {
            include: {
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

  const totalReviews = reviews.length;

  const averageRating =
    totalReviews === 0
      ? 0
      : reviews.reduce((total, review) => total + review.rating, 0) /
        totalReviews;

  return {
    averageRating: Number(averageRating.toFixed(1)),
    totalReviews,
    reviews: reviews.map((review) => ({
      id: review.id,
      rating: review.rating,
      title: review.title,
      comment: review.comment,
      createdAt: review.createdAt,
      user: review.order.user,
      event: review.order.ticket.event,
    })),
  };
};
