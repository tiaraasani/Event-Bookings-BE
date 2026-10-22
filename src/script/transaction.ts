import cron from "node-cron";
import { prisma } from "../lib/prisma.js";

export const expiredTransactionCron = () => {
  cron.schedule("* * * * *", async () => {
    try {
      const expiredOrders = await prisma.order.findMany({
        where: {
          paymentStatus: "WAITING_FOR_PAYMENT",
          expiresAt: {
            lte: new Date(),
          },
        },
        select: {
          id: true,
        },
      });

      for (const order of expiredOrders) {
        await prisma.$transaction(async (tx) => {
          // Only process an order if it is still unpaid and expired.
          // This prevents two cron executions from restoring resources twice.
          const updated = await tx.order.updateMany({
            where: {
              id: order.id,
              paymentStatus: "WAITING_FOR_PAYMENT",
              expiresAt: {
                lte: new Date(),
              },
            },
            data: {
              paymentStatus: "EXPIRED",
            },
          });

          if (updated.count === 0) {
            return;
          }

          const expiredOrder = await tx.order.findUnique({
            where: { id: order.id },
            include: {
              pointUsages: true,
            },
          });

          if (!expiredOrder) {
            throw new Error(`Order ${order.id} not found`);
          }

          // 1. Restore ticket stock.
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

          // 2. Restore the exact points used by this order.
          for (const usage of expiredOrder.pointUsages) {
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

          // 3. Make the coupon usable again, if this order used one.
          if (expiredOrder.couponId !== null) {
            await tx.coupon.update({
              where: {
                id: expiredOrder.couponId,
              },
              data: {
                isUsed: false,
              },
            });
          }

          console.log(`Order ${order.id} expired and resources restored.`);
        });
      }
    } catch (error) {
      console.error("Failed to expire unpaid orders:", error);
    }
  });
};
