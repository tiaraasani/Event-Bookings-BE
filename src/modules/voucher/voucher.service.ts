import { prisma } from "../../lib/prisma.js";
import { ApiError } from "../../utils/api-error.js";
import type {
  CreateVoucherSchema,
  UpdateVoucherSchema,
} from "./voucher.validation.js";

const getOrganization = async (userId: number) => {
  const organization = await prisma.organization.findUnique({
    where: { userId },
  });

  if (!organization) {
    throw new ApiError("Organization not found", 404);
  }

  return organization;
};

export const createVoucherService = async (
  userId: number,
  data: CreateVoucherSchema,
) => {
  const organization = await getOrganization(userId);

  const event = await prisma.event.findFirst({
    where: {
      id: data.eventId,
      organizationId: organization.id,
      deletedAt: null,
    },
  });

  if (!event) {
    throw new ApiError("Event not found or not owned by you", 404);
  }

  if (data.endDate <= new Date()) {
    throw new ApiError("Voucher end date must be in the future", 400);
  }

  const existingVoucher = await prisma.voucher.findUnique({
    where: { code: data.code },
  });

  if (existingVoucher) {
    throw new ApiError("Voucher code already exists", 409);
  }

  return prisma.voucher.create({
    data: {
      eventId: data.eventId,
      code: data.code,
      discountValue: data.discountValue,
      quota: data.quota,
      startDate: data.startDate,
      endDate: data.endDate,
    },
    include: {
      event: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  });
};

export const getMyVouchersService = async (userId: number) => {
  const organization = await getOrganization(userId);

  return prisma.voucher.findMany({
    where: {
      event: {
        organizationId: organization.id,
      },
    },
    include: {
      event: {
        select: {
          id: true,
          name: true,
          startDate: true,
          endDate: true,
        },
      },
      _count: {
        select: {
          orders: true,
        },
      },
    },
    orderBy: {
      createdAt: "desc",
    },
  });
};

export const updateVoucherService = async (
  userId: number,
  voucherId: number,
  data: UpdateVoucherSchema,
) => {
  const organization = await getOrganization(userId);

  const voucher = await prisma.voucher.findFirst({
    where: {
      id: voucherId,
      event: {
        organizationId: organization.id,
      },
    },
  });

  if (!voucher) {
    throw new ApiError("Voucher not found", 404);
  }

  const startDate = data.startDate ?? voucher.startDate;
  const endDate = data.endDate ?? voucher.endDate;

  if (endDate <= startDate) {
    throw new ApiError("End date must be after start date", 400);
  }

  if (data.quota !== undefined) {
    const usedCount = await prisma.order.count({
      where: { voucherId },
    });

    if (data.quota < usedCount) {
      throw new ApiError(
        "Quota cannot be lower than the number of orders using this voucher",
        400,
      );
    }
  }

  if (data.code) {
    const existingVoucher = await prisma.voucher.findUnique({
      where: { code: data.code },
    });

    if (existingVoucher && existingVoucher.id !== voucherId) {
      throw new ApiError("Voucher code already exists", 409);
    }
  }

  return prisma.voucher.update({
    where: { id: voucherId },
    data,
    include: {
      event: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  });
};

export const deleteVoucherService = async (
  userId: number,
  voucherId: number,
) => {
  const organization = await getOrganization(userId);

  const voucher = await prisma.voucher.findFirst({
    where: {
      id: voucherId,
      event: {
        organizationId: organization.id,
      },
    },
  });

  if (!voucher) {
    throw new ApiError("Voucher not found", 404);
  }

  const usedCount = await prisma.order.count({
    where: { voucherId },
  });

  if (usedCount > 0) {
    throw new ApiError(
      "This voucher has already been used and cannot be deleted",
      400,
    );
  }

  await prisma.voucher.delete({
    where: { id: voucherId },
  });

  return { message: "Voucher deleted successfully" };
};

export const getPublicPromotionsService = async () => {
  const now = new Date();

  const vouchers = await prisma.voucher.findMany({
    where: {
      startDate: { lte: now },
      endDate: { gte: now },
      event: { deletedAt: null },
    },
    include: {
      event: {
        select: {
          id: true,
          name: true,
          slug: true,
          image: true,
          city: true,
          startDate: true,
          endDate: true,
        },
      },
      _count: { select: { orders: true } },
    },
    orderBy: { endDate: "asc" },
  });

  return vouchers.filter((voucher) => voucher._count.orders < voucher.quota);
};
