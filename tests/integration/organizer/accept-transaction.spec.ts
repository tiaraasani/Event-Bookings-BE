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
  createCustomer,
  createEvent,
  createOrder,
  createOrganizer,
  createUser,
  signAccessToken,
  signExpiredToken,
} from "../../helpers/factories.js";

function acceptTransaction(orderId: number | string, token?: string) {
  const req = request(app).patch(`/api/organizer/transactions/${orderId}/accept`);

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

describe("PATCH /organizer/transactions/:id/accept", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should mark the transaction as paid and email the customer", async () => {
    const { organizer, customer, order } = await createPendingOrder();
    const before = new Date();

    const response = await acceptTransaction(order.id, signAccessToken(organizer));

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ message: "Transaction accepted" });

    const updated = await prisma.order.findUniqueOrThrow({
      where: { id: order.id },
    });
    expect(updated.paymentStatus).toBe(PaymentStatus.PAID);
    expect(updated.paidAt).not.toBeNull();
    expect(updated.paidAt!.getTime()).toBeGreaterThanOrEqual(
      before.getTime() - 1000,
    );

    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(vi.mocked(sendMail).mock.calls[0][0]).toMatchObject({
      to: customer.email,
      subject: "Your payment has been accepted",
      templateName: "transaction-accepted.hbs",
      context: {
        name: "Budi Santoso",
        eventName: "Jakarta Music Fest",
        orderId: order.id,
        ticketName: "VIP",
        quantity: 2,
      },
    });
  });

  it("should not touch the ticket stock when accepting", async () => {
    const { organizer, ticket, order } = await createPendingOrder();

    await acceptTransaction(order.id, signAccessToken(organizer));

    const updatedTicket = await prisma.ticket.findUniqueOrThrow({
      where: { id: ticket.id },
    });
    expect(updatedTicket.availableQuantity).toBe(48);
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
      paymentStatus: status,
    });

    const response = await acceptTransaction(order.id, signAccessToken(organizer));

    expect(response.status).toBe(400);
    expect(response.body.message).toBe(
      "Transaction is not waiting for confirmation",
    );
    expect(sendMail).not.toHaveBeenCalled();

    const unchanged = await prisma.order.findUniqueOrThrow({
      where: { id: order.id },
    });
    expect(unchanged.paymentStatus).toBe(status);
  });

  it("should return 404 when the transaction belongs to another organizer's event", async () => {
    const { order } = await createPendingOrder();
    const other = await createOrganizer({ organizationName: "Globex" });

    const response = await acceptTransaction(order.id, signAccessToken(other.user));

    expect(response.status).toBe(404);
    expect(response.body.message).toBe("Transaction not found");
    expect(sendMail).not.toHaveBeenCalled();

    const unchanged = await prisma.order.findUniqueOrThrow({
      where: { id: order.id },
    });
    expect(unchanged.paymentStatus).toBe(PaymentStatus.WAITING_FOR_CONFIRMATION);
  });

  it("should return 404 when the transaction does not exist", async () => {
    const { user } = await createOrganizer();

    const response = await acceptTransaction(999_999, signAccessToken(user));

    expect(response.status).toBe(404);
    expect(response.body.message).toBe("Transaction not found");
  });

  it("should return 404 when the organizer has no organization", async () => {
    const organizerWithoutOrganization = await createUser({
      role: Role.ORGANIZER,
    });

    const response = await acceptTransaction(
      1,
      signAccessToken(organizerWithoutOrganization),
    );

    expect(response.status).toBe(404);
    expect(response.body.message).toBe("Organization not found");
  });

  it("should return 403 when a customer tries to accept a transaction", async () => {
    const { customer, order } = await createPendingOrder();

    const response = await acceptTransaction(order.id, signAccessToken(customer));

    expect(response.status).toBe(403);
    expect(response.body.message).toBe("Forbidden");
  });

  it("should return 401 when no token is provided", async () => {
    const response = await acceptTransaction(1);

    expect(response.status).toBe(401);
    expect(response.body.message).toBe("Token not provided");
  });

  it("should return 401 for an invalid token", async () => {
    const response = await acceptTransaction(1, "not-a-token");

    expect(response.status).toBe(401);
    expect(response.body.message).toBe("Invalid token");
  });

  it("should return 401 for an expired token", async () => {
    const { user } = await createOrganizer();

    const response = await acceptTransaction(1, signExpiredToken(user));

    expect(response.status).toBe(401);
    expect(response.body.message).toBe("Token expired");
  });
});
