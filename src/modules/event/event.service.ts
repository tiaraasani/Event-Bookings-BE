import { prisma } from "../../lib/prisma.js";
import { ApiError } from "../../utils/api-error.js";
import type {
  CreateEventSchema,
  UpdateEventSchema,
} from "./event.validation.js";

export const createEventService = async (data: CreateEventSchema) => {
  const event = await prisma.event.create({
    data: {
      categoryId: data.categoryId,
      organizationId: data.organizationId,
      name: data.name,
      description: data.description,
      city: data.city,
      type: data.type,
      slug: data.slug,
      image: data.image,
      startDate: data.startDate,
      endDate: data.endDate,
      tickets: {
        create: data.tickets.map((ticket) => ({
          name: ticket.name,
          price: ticket.price,
          quantity: ticket.quantity,
          availableQuantity: ticket.quantity,
        })),
      },
    },
    include: {
      category: true,
      organization: {
        select: {
          id: true,
          name: true,
          logo: true,
        },
      },
      tickets: true,
    },
  });

  return event;
};

export const getEventsService = async () => {
  const events = await prisma.event.findMany({
    where: {
      deletedAt: null,
    },
    include: {
      category: true,
      organization: {
        select: {
          id: true,
          name: true,
          logo: true,
        },
      },
      tickets: true,
    },
    orderBy: {
      startDate: "asc",
    },
  });

  return events;
};

export const getEventByIdService = async (id: number) => {
  const event = await prisma.event.findUnique({
    where: {
      id,
    },
    include: {
      category: true,
      organization: {
        select: {
          id: true,
          name: true,
          logo: true,
        },
      },
      tickets: true,
    },
  });

  if (!event || event.deletedAt !== null) {
    throw new ApiError("Event not found", 404);
  }

  return event;
};

export const updateEventService = async (
  id: number,
  data: UpdateEventSchema,
) => {
  const event = await prisma.event.findUnique({
    where: { id },
  });

  if (!event) {
    throw new ApiError("Event not found", 404);
  }

  const updatedEvent = await prisma.event.update({
    where: { id },
    data,
    include: {
      category: true,
      organization: {
        select: {
          id: true,
          name: true,
          logo: true,
        },
      },
      tickets: true,
    },
  });

  return updatedEvent;
};

export const deleteEventService = async (id: number) => {
  const event = await prisma.event.findUnique({
    where: { id },
  });

  if (!event || event.deletedAt !== null) {
    throw new ApiError("Event not found", 404);
  }

  await prisma.event.update({
    where: { id },
    data: {
      deletedAt: new Date(),
    },
  });

  return { message: "Event deleted successfully" };
};
