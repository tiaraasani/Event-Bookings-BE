import cron from "node-cron";
import { prisma } from "../lib/prisma.js";

export const expiredTransactionCron = () => {
  cron.schedule("* * * * *", async () => {
    console.log("Checking for expired transactions...");

    const now = new Date();

    try {
      const expiredOrders = await prisma.order.findMany({
        where: {
          paymentStatus: "WAITING_FOR_PAYMENT",
          expiresAt: {
            lte: now,
          },
        },
        select: {
          id: true,
        },
      });

      for (const order of expiredOrders) {
        await prisma.$transaction(async (tx) => {
          // Prevent the same order from being processed twice.
          const updatedOrder = await tx.order.updateMany({
            where: {
              id: order.id,
              paymentStatus: "WAITING_FOR_PAYMENT",
              expiresAt: {
                lte: now,
              },
            },
            data: {
              paymentStatus: "EXPIRED",
            },
          });

          // If another process already handled this order, skip it.
          if (updatedOrder.count === 0) {
            return;
          }

          // Retrieve the order details needed to restore its ticket stock.
          const expiredOrder = await tx.order.findUniqueOrThrow({
            where: {
              id: order.id,
            },
          });

          // Return the reserved tickets.
          await tx.ticket.update({
            where: {
              id: expiredOrder.ticketId,
            },
            data: {
              availableQuantity: {
                increment: expiredOrder.quantity,
              },
            },
          });

          // Find the points used for this order.
          const pointUsages = await tx.pointUsage.findMany({
            where: {
              orderId: expiredOrder.id,
            },
            include: {
              point: true,
            },
          });

          // Restore points only if their original expiry date
          // has not passed.
          for (const usage of pointUsages) {
            if (usage.point.expiresAt > now) {
              await tx.point.update({
                where: {
                  id: usage.pointId,
                },
                data: {
                  amount: {
                    increment: usage.amount,
                  },
                },
              });
            }
          }

          if (expiredOrder.couponId) {
            await tx.coupon.updateMany({
              where: {
                id: expiredOrder.couponId,
                expiresAt: { gt: now },
              },
              data: { isUsed: false },
            });
          }

          console.log(`Order ${expiredOrder.id} expired successfully.`);
        });
      }
    } catch (error) {
      console.error("Error while expiring transactions:", error);
    }
  });

  console.log("Transaction expiration cron job started.");
};
