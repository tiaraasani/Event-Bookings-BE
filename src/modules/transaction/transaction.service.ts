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
      include: {
        event: true,
      },
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

    const stockUpdate = await tx.ticket.updateMany({
      where: {
        id: data.ticketId,
        availableQuantity: {
          gte: data.quantity,
        },
      },
      data: {
        availableQuantity: {
          decrement: data.quantity,
        },
      },
    });

    if (stockUpdate.count !== 1) {
      throw new ApiError("Not enough tickets available", 400);
    }

    const total = ticket.price * data.quantity;
    const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000);

    const order = await tx.order.create({
      data: {
        userId,
        ticketId: ticket.id,
        quantity: data.quantity,
        total,
        finalPrice: total,
        paymentStatus: PaymentStatus.WAITING_FOR_PAYMENT,
        expiresAt,
      },
      include: {
        ticket: {
          include: {
            event: true,
          },
        },
      },
    });

    return order;
  });
};

// Add this function below createTransactionService.
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
