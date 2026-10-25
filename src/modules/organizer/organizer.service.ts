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
type StatRow = {
  label: string;
  tickets: number;
  revenue: number;
};

const MONTH_LABELS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

function emptyRows(labels: string[]): StatRow[] {
  return labels.map((label) => ({ label, tickets: 0, revenue: 0 }));
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
export async function getStatistics(
  userId: number,
  year: number,
  month: number,
) {
  const organization = await getOrganization(userId);

  const totalEvents = await prisma.event.count({
    where: {
      organizationId: organization.id,
      deletedAt: null,
    },
  });

  const orders = await prisma.order.findMany({
    where: {
      paymentStatus: "PAID",
      ticket: {
        event: {
          organizationId: organization.id,
        },
      },
    },
    select: {
      quantity: true,
      finalPrice: true,
      paidAt: true,
      createdAt: true,
    },
  });

  const summary = {
    totalEvents: totalEvents,
    totalOrders: orders.length,
    totalTickets: 0,
    totalRevenue: 0,
  };

  const yearMap: Record<number, StatRow> = {};
  const byMonth = emptyRows(MONTH_LABELS);

  const daysInMonth = new Date(year, month, 0).getDate();
  const dayLabels: string[] = [];
  for (let day = 1; day <= daysInMonth; day++) {
    dayLabels.push(String(day));
  }
  const byDay = emptyRows(dayLabels);

  for (const order of orders) {
    summary.totalTickets += order.quantity;
    summary.totalRevenue += order.finalPrice;

    const date = order.paidAt ?? order.createdAt;
    const orderYear = date.getFullYear();
    const orderMonth = date.getMonth() + 1;
    const orderDay = date.getDate();

    if (!yearMap[orderYear]) {
      yearMap[orderYear] = {
        label: String(orderYear),
        tickets: 0,
        revenue: 0,
      };
    }
    yearMap[orderYear].tickets += order.quantity;
    yearMap[orderYear].revenue += order.finalPrice;

    if (orderYear === year) {
      byMonth[orderMonth - 1].tickets += order.quantity;
      byMonth[orderMonth - 1].revenue += order.finalPrice;

      if (orderMonth === month) {
        byDay[orderDay - 1].tickets += order.quantity;
        byDay[orderDay - 1].revenue += order.finalPrice;
      }
    }
  }

  const byYear = Object.values(yearMap);

  return { year, month, summary, byYear, byMonth, byDay };
}
export async function getEventAttendees(userId: number, eventId: number) {
  const organization = await getOrganization(userId);

  const event = await prisma.event.findFirst({
    where: {
      id: eventId,
      organizationId: organization.id,
      deletedAt: null,
    },
    select: {
      id: true,
      name: true,
      startDate: true,
    },
  });

  if (!event) {
    throw new ApiError("Event not found", 404);
  }

  const orders = await prisma.order.findMany({
    where: {
      paymentStatus: "PAID",
      ticket: {
        eventId: event.id,
      },
    },
    include: {
      user: {
        select: { name: true, email: true },
      },
      ticket: {
        select: { name: true },
      },
    },
    orderBy: {
      paidAt: "asc",
    },
  });

  const attendees = orders.map((order) => ({
    orderId: order.id,
    name: order.user.name,
    email: order.user.email,
    ticketName: order.ticket.name,
    quantity: order.quantity,
    totalPaid: order.finalPrice,
    paidAt: order.paidAt,
  }));

  let totalTickets = 0;
  let totalRevenue = 0;
  for (const attendee of attendees) {
    totalTickets += attendee.quantity;
    totalRevenue += attendee.totalPaid;
  }

  return {
    event,
    summary: {
      totalAttendees: attendees.length,
      totalTickets,
      totalRevenue,
    },
    attendees,
  };
}

export async function getMyOrganization(userId: number) {
  const organization = await prisma.organization.findUnique({
    where: {
      userId,
    },
    select: {
      id: true,
      name: true,
    },
  });

  if (!organization) {
    throw new ApiError("Organization not found", 404);
  }

  return organization;
}
