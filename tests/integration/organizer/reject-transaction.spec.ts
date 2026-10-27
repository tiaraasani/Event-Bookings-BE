import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PaymentStatus, Role } from "../../../src/generated/prisma/enums.js";
import { prisma } from "../../../src/lib/prisma.js";

vi.mock("../../../src/lib/mail.js", () => ({
  sendMail: vi.fn(),
}));

import { app } from "../../../src/app.js";
import { sendMail } from "../../../src/lib/mail.js";
import {
  createCoupon,
  createCustomer,
  createEvent,
  createOrder,
  createOrganizer,
  createPoint,
  createUser,
  createVoucher,
  signAccessToken,
  signExpiredToken,
} from "../../helpers/factories.js";

function rejectTransaction(orderId: number | string, token?: string) {
  const req = request(app).patch(`/api/organizer/transactions/${orderId}/reject`);

  if (token !== undefined) {
    req.set("Authorization", `Bearer ${token}`);
  }

  return req;
}

async function createPendingOrder() {
  const { user, organization } = await createOrganizer();
  const { event, ticket } = await createEvent(organization.id, {
    name: "Jakarta Music Fest",
    tickets: [{ name: "VIP", price: 250_000, quantity: 50, availableQuantity: 48 }],
  });
  const customer = await createCustomer({ name: "Budi Santoso" });
  const order = await createOrder(customer.id, ticket.id, {
    quantity: 2,
    total: 500_000,
    paymentStatus: PaymentStatus.WAITING_FOR_CONFIRMATION,
    paymentProofUrl: "https://res.cloudinary.com/demo/proof.png",
  });

  return { organizer: user, organization, event, ticket, customer, order };
}

describe("PATCH /organizer/transactions/:id/reject", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should mark the transaction as rejected, restore the ticket stock and email the customer", async () => {
    const { organizer, customer, ticket, order } = await createPendingOrder();

    const response = await rejectTransaction(order.id, signAccessToken(organizer));

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ message: "Transaction rejected" });

    const updated = await prisma.order.findUniqueOrThrow({
      where: { id: order.id },
    });
    expect(updated.paymentStatus).toBe(PaymentStatus.REJECTED);
    expect(updated.paidAt).toBeNull();

    const updatedTicket = await prisma.ticket.findUniqueOrThrow({
      where: { id: ticket.id },
    });
    expect(updatedTicket.availableQuantity).toBe(50);

    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(vi.mocked(sendMail).mock.calls[0][0]).toMatchObject({
      to: customer.email,
      subject: "Your payment has been rejected",
      templateName: "transaction-rejected.hbs",
      context: {
        name: "Budi Santoso",
        eventName: "Jakarta Music Fest",
        orderId: order.id,
      },
    });
  });

  it("should give back the points used on the order and remove the usage records", async () => {
    const { organizer, customer, ticket } = await createPendingOrder();
    const firstPoint = await createPoint(customer.id, { amount: 0 });
    const secondPoint = await createPoint(customer.id, { amount: 2_000 });
    const order = await createOrder(customer.id, ticket.id, {
      total: 100_000,
      pointsUsed: 18_000,
      paymentStatus: PaymentStatus.WAITING_FOR_CONFIRMATION,
    });
    await prisma.pointUsage.createMany({
      data: [
        { orderId: order.id, pointId: firstPoint.id, amount: 10_000 },
        { orderId: order.id, pointId: secondPoint.id, amount: 8_000 },
      ],
    });

    const response = await rejectTransaction(order.id, signAccessToken(organizer));

    expect(response.status).toBe(200);
    expect(
      (await prisma.point.findUniqueOrThrow({ where: { id: firstPoint.id } }))
        .amount,
    ).toBe(10_000);
    expect(
      (await prisma.point.findUniqueOrThrow({ where: { id: secondPoint.id } }))
        .amount,
    ).toBe(10_000);
    expect(await prisma.pointUsage.count({ where: { orderId: order.id } })).toBe(
      0,
    );
  });

  it("should make the coupon usable again", async () => {
    const { organizer, customer, ticket } = await createPendingOrder();
    const coupon = await createCoupon(customer.id, { isUsed: true });
    const order = await createOrder(customer.id, ticket.id, {
      total: 100_000,
      discount: 10_000,
      couponId: coupon.id,
      paymentStatus: PaymentStatus.WAITING_FOR_CONFIRMATION,
    });

    const response = await rejectTransaction(order.id, signAccessToken(organizer));

    expect(response.status).toBe(200);
    const updatedCoupon = await prisma.coupon.findUniqueOrThrow({
      where: { id: coupon.id },
    });
    expect(updatedCoupon.isUsed).toBe(false);
  });

  it("should give back the voucher quota", async () => {
    const { organizer, customer, event, ticket } = await createPendingOrder();
    const voucher = await createVoucher(event.id, { quota: 4 });
    const order = await createOrder(customer.id, ticket.id, {
      total: 100_000,
      discount: 10_000,
      voucherId: voucher.id,
      paymentStatus: PaymentStatus.WAITING_FOR_CONFIRMATION,
    });

    const response = await rejectTransaction(order.id, signAccessToken(organizer));

    expect(response.status).toBe(200);
    const updatedVoucher = await prisma.voucher.findUniqueOrThrow({
      where: { id: voucher.id },
    });
    expect(updatedVoucher.quota).toBe(5);
  });

  it.each([
    PaymentStatus.WAITING_FOR_PAYMENT,
    PaymentStatus.PAID,
    PaymentStatus.REJECTED,
    PaymentStatus.EXPIRED,
    PaymentStatus.CANCELED,
  ])("should return 400 when the transaction status is %s", async (status) => {
    const { organizer, ticket, customer } = await createPendingOrder();
    const order = await createOrder(customer.id, ticket.id, {
      quantity: 1,
      paymentStatus: status,
    });

    const response = await rejectTransaction(order.id, signAccessToken(organizer));

    expect(response.status).toBe(400);
    expect(response.body.message).toBe(
      "Transaction is not waiting for confirmation",
    );
    expect(sendMail).not.toHaveBeenCalled();

    const unchanged = await prisma.order.findUniqueOrThrow({
      where: { id: order.id },
    });
    expect(unchanged.paymentStatus).toBe(status);
    const unchangedTicket = await prisma.ticket.findUniqueOrThrow({
      where: { id: ticket.id },
    });
    expect(unchangedTicket.availableQuantity).toBe(48);
  });

  it("should return 404 when the transaction belongs to another organizer's event", async () => {
    const { order, ticket } = await createPendingOrder();
    const other = await createOrganizer({ organizationName: "Globex" });

    const response = await rejectTransaction(order.id, signAccessToken(other.user));

    expect(response.status).toBe(404);
    expect(response.body.message).toBe("Transaction not found");
    expect(sendMail).not.toHaveBeenCalled();

    const unchanged = await prisma.order.findUniqueOrThrow({
      where: { id: order.id },
    });
    expect(unchanged.paymentStatus).toBe(PaymentStatus.WAITING_FOR_CONFIRMATION);
    const unchangedTicket = await prisma.ticket.findUniqueOrThrow({
      where: { id: ticket.id },
    });
    expect(unchangedTicket.availableQuantity).toBe(48);
  });

  it("should return 404 when the transaction does not exist", async () => {
    const { user } = await createOrganizer();

    const response = await rejectTransaction(999_999, signAccessToken(user));

    expect(response.status).toBe(404);
    expect(response.body.message).toBe("Transaction not found");
  });

  it("should return 404 when the organizer has no organization", async () => {
    const organizerWithoutOrganization = await createUser({
      role: Role.ORGANIZER,
    });

    const response = await rejectTransaction(
      1,
      signAccessToken(organizerWithoutOrganization),
    );

    expect(response.status).toBe(404);
    expect(response.body.message).toBe("Organization not found");
  });

  it("should return 403 when a customer tries to reject a transaction", async () => {
    const { customer, order } = await createPendingOrder();

    const response = await rejectTransaction(order.id, signAccessToken(customer));

    expect(response.status).toBe(403);
    expect(response.body.message).toBe("Forbidden");
  });

  it("should return 401 when no token is provided", async () => {
    const response = await rejectTransaction(1);

    expect(response.status).toBe(401);
    expect(response.body.message).toBe("Token not provided");
  });

  it("should return 401 for an invalid token", async () => {
    const response = await rejectTransaction(1, "not-a-token");

    expect(response.status).toBe(401);
    expect(response.body.message).toBe("Invalid token");
  });

  it("should return 401 for an expired token", async () => {
    const { user } = await createOrganizer();

    const response = await rejectTransaction(1, signExpiredToken(user));

    expect(response.status).toBe(401);
    expect(response.body.message).toBe("Token expired");
  });
});
