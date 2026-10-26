import { prisma } from "../../lib/prisma.js";
import { ApiError } from "../../utils/api-error.js";
import type { CreateTransactionSchema } from "./transaction.validation.js";
import { PaymentStatus } from "../../generated/prisma/client";
import { uploadImage } from "../../lib/cloudinary.js";

export const createTransactionService = async (
  userId: number,
  data: CreateTransactionSchema,
) => {
  return prisma.$transaction(async (tx) => {
    const ticket = await tx.ticket.findUnique({
      where: { id: data.ticketId },
      include: { event: true },
    });

    if (!ticket || ticket.event.deletedAt !== null) {
      throw new ApiError("Ticket or event not found", 404);
    }

    if (ticket.event.endDate <= new Date()) {
      throw new ApiError("This event has already ended", 400);
    }

    if (ticket.availableQuantity < data.quantity) {
      throw new ApiError("Not enough tickets available", 400);
    }

    const total = ticket.price * data.quantity;
    const pointsToUse = data.pointsToUse ?? 0;
    const now = new Date();

    let voucherId: number | null = null;
    let voucherDiscount = 0;

    if (data.voucherCode) {
      const voucher = await tx.voucher.findUnique({
        where: {
          code: data.voucherCode.trim().toUpperCase(),
        },
      });

      if (!voucher) {
        throw new ApiError("Invalid voucher code", 400);
      }

      if (voucher.eventId !== ticket.eventId) {
        throw new ApiError("This voucher is not valid for this event", 400);
      }

      if (now < voucher.startDate || now > voucher.endDate) {
        throw new ApiError("This voucher is not currently valid", 400);
      }

      const usedQuota = await tx.order.count({
        where: {
          voucherId: voucher.id,
        },
      });

      if (usedQuota >= voucher.quota) {
        throw new ApiError("This voucher has reached its quota", 400);
      }

      voucherId = voucher.id;
      voucherDiscount = Math.floor((total * voucher.discountValue) / 100);
    }

    const totalAfterVoucher = total - voucherDiscount;

    // Coupon: a system reward (from referral) that belongs to this user and
    // works on any event. Applied after the voucher, before points.
    let couponId: number | null = null;
    let couponDiscount = 0;

    if (data.couponCode) {
      const coupon = await tx.coupon.findUnique({
        where: { code: data.couponCode.trim().toUpperCase() },
      });

      if (!coupon || coupon.userId !== userId) {
        throw new ApiError("Invalid coupon code", 400);
      }

      if (coupon.isUsed) {
        throw new ApiError("This coupon has already been used", 400);
      }

      if (coupon.expiresAt <= now) {
        throw new ApiError("This coupon has expired", 400);
      }

      couponId = coupon.id;
      // A coupon can never push the price below zero.
      couponDiscount = Math.min(coupon.discountValue, totalAfterVoucher);
    }

    const totalAfterDiscounts = totalAfterVoucher - couponDiscount;

    if (pointsToUse > totalAfterDiscounts) {
      throw new ApiError(
        "Points cannot exceed the ticket total after voucher and coupon discounts",
        400,
      );
    }

    const pointRecords = await tx.point.findMany({
      where: {
        userId,
        expiresAt: { gt: now },
        amount: { gt: 0 },
      },
      orderBy: { expiresAt: "asc" },
    });

    const availablePoints = pointRecords.reduce(
      (sum, point) => sum + point.amount,
      0,
    );

    if (pointsToUse > availablePoints) {
      throw new ApiError("Insufficient points balance", 400);
    }

    const stockUpdate = await tx.ticket.updateMany({
      where: {
        id: data.ticketId,
        availableQuantity: { gte: data.quantity },
      },
      data: {
        availableQuantity: { decrement: data.quantity },
      },
    });

    if (stockUpdate.count !== 1) {
      throw new ApiError("Not enough tickets available", 400);
    }

    const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000);

    const totalDiscount = voucherDiscount + couponDiscount + pointsToUse;
    const finalPrice = total - totalDiscount;

    const order = await tx.order.create({
      data: {
        userId,
        ticketId: ticket.id,
        quantity: data.quantity,
        total,
        voucherId,
        couponId,
        pointsUsed: pointsToUse,
        discount: totalDiscount,
        finalPrice,
        paymentStatus: PaymentStatus.WAITING_FOR_PAYMENT,
        expiresAt,
      },
    });

    // Mark the coupon as used so it cannot be applied to another order.
    // It is released again if the order is rejected, expired, or canceled.
    if (couponId) {
      await tx.coupon.update({
        where: { id: couponId },
        data: { isUsed: true },
      });
    }

    let remainingPoints = pointsToUse;

    for (const point of pointRecords) {
      if (remainingPoints <= 0) break;

      const amountToUse = Math.min(point.amount, remainingPoints);

      await tx.point.update({
        where: { id: point.id },
        data: {
          amount: { decrement: amountToUse },
        },
      });

      await tx.pointUsage.create({
        data: {
          orderId: order.id,
          pointId: point.id,
          amount: amountToUse,
        },
      });

      remainingPoints -= amountToUse;
    }

    return tx.order.findUniqueOrThrow({
      where: { id: order.id },
      include: {
        ticket: {
          include: { event: true },
        },
        voucher: true,
        coupon: true,
        pointUsages: true,
      },
    });
  });
};

export const uploadPaymentProofService = async (
  userId: number,
  orderId: number,
  imageFile: Express.Multer.File,
) => {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
  });

  if (!order || order.userId !== userId) {
    throw new ApiError("Transaction not found", 404);
  }

  if (order.paymentStatus !== "WAITING_FOR_PAYMENT") {
    throw new ApiError(
      "Payment proof can only be uploaded while waiting for payment",
      400,
    );
  }

  if (!order.expiresAt || order.expiresAt <= new Date()) {
    throw new ApiError("Payment deadline has expired", 400);
  }

  const uploadedImage = await uploadImage(imageFile);

  const updatedOrder = await prisma.order.update({
    where: { id: orderId },
    data: {
      paymentProofUrl: uploadedImage.secure_url,
      paymentStatus: "WAITING_FOR_CONFIRMATION",
    },
  });

  return updatedOrder;
};

export const getMyTransactionsService = async (userId: number) => {
  const transactions = await prisma.order.findMany({
    where: {
      userId,
    },
    include: {
      ticket: {
        include: {
          event: {
            include: {
              category: true,
              organization: true,
            },
          },
        },
      },
      coupon: true,
      voucher: true,
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  return transactions;
};

export const getMyPointBalanceService = async (userId: number) => {
  const points = await prisma.point.findMany({
    where: {
      userId,
      expiresAt: {
        gt: new Date(),
      },
      amount: {
        gt: 0,
      },
    },
  });

  return points.reduce((total, point) => total + point.amount, 0);
};
