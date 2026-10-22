import { prisma } from "../../lib/prisma.js";
import { ApiError } from "../../utils/api-error.js";
import type {
  CreateEventSchema,
  UpdateEventSchema,
} from "./event.validation.js";
import { uploadImage } from "../../lib/cloudinary.js";

const getOrganization = async (userId: number) => {
  const organization = await prisma.organization.findUnique({
    where: { userId },
  });

  if (!organization) {
    throw new ApiError("Organization not found", 404);
  }

  return organization;
};

export const createEventService = async (
  userId: number,
  data: CreateEventSchema,
  imageFile?: Express.Multer.File,
) => {
  const organization = await getOrganization(userId);
  let imageUrl = data.image || null;

  if (imageFile) {
    const uploadedImage = await uploadImage(imageFile);
    imageUrl = uploadedImage.secure_url;
  }

  let categoryId = data.categoryId;

  if (data.customCategory?.trim()) {
    const categoryName = data.customCategory.trim();

    const category = await prisma.category.upsert({
      where: {
        name: categoryName,
      },
      update: {},
      create: {
        name: categoryName,
      },
    });

    categoryId = category.id;
  }

  if (!categoryId) {
    throw new ApiError("Please select a category", 400);
  }

  const event = await prisma.event.create({
    data: {
      categoryId,
      organizationId: organization.id,
      name: data.name,
      description: data.description,
      city: data.city,
      type: data.type,
      slug: data.slug,
      image: imageUrl,
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
      endDate: {
        gt: new Date(),
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
    orderBy: {
      startDate: "asc",
    },
  });

  return events;
};

export const getEventByIdService = async (id: number) => {
  const event = await prisma.event.findUnique({
    where: {
      id: id,
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

  if (!event || event.deletedAt !== null || event.endDate <= new Date()) {
    throw new ApiError("Event not found", 404);
  }

  return event;
};
export const updateEventService = async (
  userId: number,
  id: number,
  data: UpdateEventSchema,
) => {
  const organization = await getOrganization(userId);
  const event = await prisma.event.findUnique({
    where: { id },
  });

  if (!event || event.organizationId !== organization.id) {
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

export const deleteEventService = async (userId: number, id: number) => {
  const organization = await getOrganization(userId);
  const event = await prisma.event.findUnique({
    where: { id },
  });

  if (
    !event ||
    event.deletedAt !== null ||
    event.organizationId !== organization.id
  ) {
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

export const getMyOrganizedEventsService = async (userId: number) => {
  const organization = await prisma.organization.findUnique({
    where: {
      userId,
    },
  });

  if (!organization) {
    return [];
  }

  return prisma.event.findMany({
    where: {
      organizationId: organization.id,
      deletedAt: null,
    },
    include: {
      category: true,
      tickets: true,
      organization: {
        select: {
          id: true,
          name: true,
          logo: true,
        },
      },
    },
    orderBy: {
      startDate: "asc",
    },
  });
};
