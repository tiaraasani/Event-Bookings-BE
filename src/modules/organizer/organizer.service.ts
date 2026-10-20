import { prisma } from "../../lib/prisma";
import { ApiError } from "../../utils/api-error";
import { sendMail } from "../../lib/mail";

async function getOrganization(userId: number) {
  const organization = await prisma.organization.findUnique({
    where: { userId: userId },
  });
  if (!organization) {
    throw new ApiError("Organization not found", 404);
  }
  return organization;
}

async function getOwnedOrder(orderId: number, organizationId: number) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      user: true,
      ticket: {
        include: {
          event: true,
        },
      },
      pointUsages: true,
    },
  });
  if (!order || order.ticket.event.organizationId !== organizationId) {
    throw new ApiError("Transaction not found", 404);
  }
  return order;
}

export async function getTransactions(userId: number) {
  const organization = await getOrganization(userId);

  const orders = await prisma.order.findMany({
    where: {
      ticket: {
        event: {
          organizationId: organization.id,
        },
      },
    },
    include: {
      user: {
        select: { id: true, name: true, email: true },
      },
      ticket: {
        include: {
          event: {
            select: { id: true, name: true, startDate: true },
          },
        },
      },
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  return orders;
}

export async function acceptTransaction(userId: number, orderId: number) {
  const organization = await getOrganization(userId);
  const order = await getOwnedOrder(orderId, organization.id);

  if (order.paymentStatus !== "WAITING_FOR_CONFIRMATION") {
    throw new ApiError("Transaction is not waiting for confirmation", 400);
  }

  await prisma.order.update({
    where: { id: order.id },
    data: {
      paymentStatus: "PAID",
      paidAt: new Date(),
    },
  });

  await sendMail({
    to: order.user.email,
    subject: "Your payment has been accepted",
    templateName: "transaction-accepted.hbs",
    context: {
      name: order.user.name,
      eventName: order.ticket.event.name,
      orderId: order.id,
      ticketName: order.ticket.name,
      quantity: order.quantity,
      finalPrice: order.finalPrice.toLocaleString("id-ID"),
    },
  });

  return { message: "Transaction accepted" };
}

export async function rejectTransaction(userId: number, orderId: number) {
  const organization = await getOrganization(userId);
  const order = await getOwnedOrder(orderId, organization.id);

  if (order.paymentStatus !== "WAITING_FOR_CONFIRMATION") {
    throw new ApiError("Transaction is not waiting for confirmation", 400);
  }

  await prisma.$transaction(async (tx) => {
    await tx.order.update({
      where: { id: order.id },
      data: {
        paymentStatus: "REJECTED",
      },
    });

    await tx.ticket.update({
      where: { id: order.ticketId },
      data: {
        availableQuantity: { increment: order.quantity },
      },
    });

    for (const usage of order.pointUsages) {
      await tx.point.update({
        where: { id: usage.pointId },
        data: {
          amount: { increment: usage.amount },
        },
      });
    }
    await tx.pointUsage.deleteMany({
      where: { orderId: order.id },
    });

    if (order.couponId) {
      await tx.coupon.update({
        where: { id: order.couponId },
        data: { isUsed: false },
      });
    }

    if (order.voucherId) {
      await tx.voucher.update({
        where: { id: order.voucherId },
        data: {
          quota: { increment: 1 },
        },
      });
    }
  });

  await sendMail({
    to: order.user.email,
    subject: "Your payment has been rejected",
    templateName: "transaction-rejected.hbs",
    context: {
      name: order.user.name,
      eventName: order.ticket.event.name,
      orderId: order.id,
    },
  });

  return { message: "Transaction rejected" };
}
