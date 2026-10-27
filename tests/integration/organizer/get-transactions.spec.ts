import request from "supertest";
import { describe, expect, it } from "vitest";
import { PaymentStatus, Role } from "../../../src/generated/prisma/enums.js";
import { prisma } from "../../../src/lib/prisma.js";
import { app } from "../../../src/app.js";
import {
  createCustomer,
  createEvent,
  createOrder,
  createOrganizer,
  createUser,
  signAccessToken,
  signExpiredToken,
} from "../../helpers/factories.js";

function getTransactions(query: object = {}, token?: string) {
  const req = request(app).get("/api/organizer/transactions").query(query);

  if (token !== undefined) {
    req.set("Authorization", `Bearer ${token}`);
  }

  return req;
}

describe("GET /organizer/transactions", () => {
  it("should return the organizer's transactions with customer, ticket and event details, newest first", async () => {
    const { user, organization } = await createOrganizer();
    const { event, ticket } = await createEvent(organization.id, {
      name: "Jakarta Music Fest",
      tickets: [{ name: "VIP", price: 250_000 }],
    });
    const budi = await createCustomer({ name: "Budi" });
    const sari = await createCustomer({ name: "Sari" });
    const older = await createOrder(budi.id, ticket.id);
    await prisma.order.update({
      where: { id: older.id },
      data: { createdAt: new Date(Date.now() - 60_000) },
    });
    const newer = await createOrder(sari.id, ticket.id, {
      quantity: 2,
      total: 500_000,
      paymentStatus: PaymentStatus.WAITING_FOR_CONFIRMATION,
    });

    const response = await getTransactions({}, signAccessToken(user));

    expect(response.status).toBe(200);
    expect(response.body.meta).toEqual({ page: 1, take: 10, total: 2 });
    expect(response.body.data).toHaveLength(2);
    expect(response.body.data[0]).toMatchObject({
      id: newer.id,
      quantity: 2,
      finalPrice: 500_000,
      paymentStatus: PaymentStatus.WAITING_FOR_CONFIRMATION,
      user: { id: sari.id, name: "Sari", email: sari.email },
      ticket: {
        id: ticket.id,
        name: "VIP",
        event: { id: event.id, name: "Jakarta Music Fest" },
      },
    });
    expect(response.body.data[1].id).toBe(older.id);
  });

  it("should not expose the customer's password", async () => {
    const { user, organization } = await createOrganizer();
    const { ticket } = await createEvent(organization.id);
    const customer = await createCustomer();
    await createOrder(customer.id, ticket.id);

    const response = await getTransactions({}, signAccessToken(user));

    expect(response.status).toBe(200);
    expect(response.body.data[0].user).toEqual({
      id: customer.id,
      name: customer.name,
      email: customer.email,
    });
  });

  it("should only return transactions of the authenticated organizer's events", async () => {
    const acme = await createOrganizer({ organizationName: "Acme" });
    const globex = await createOrganizer({ organizationName: "Globex" });
    const acmeEvent = await createEvent(acme.organization.id);
    const globexEvent = await createEvent(globex.organization.id);
    const customer = await createCustomer();
    const acmeOrder = await createOrder(customer.id, acmeEvent.ticket.id);
    await createOrder(customer.id, globexEvent.ticket.id);

    const response = await getTransactions({}, signAccessToken(acme.user));

    expect(response.status).toBe(200);
    expect(response.body.meta.total).toBe(1);
    expect(response.body.data[0].id).toBe(acmeOrder.id);
  });

  it("should paginate with page and take", async () => {
    const { user, organization } = await createOrganizer();
    const { ticket } = await createEvent(organization.id);
    const customer = await createCustomer();
    for (let i = 0; i < 5; i++) {
      await createOrder(customer.id, ticket.id);
    }

    const response = await getTransactions(
      { page: 2, take: 2 },
      signAccessToken(user),
    );

    expect(response.status).toBe(200);
    expect(response.body.meta).toEqual({ page: 2, take: 2, total: 5 });
    expect(response.body.data).toHaveLength(2);
  });

  it("should filter by payment status", async () => {
    const { user, organization } = await createOrganizer();
    const { ticket } = await createEvent(organization.id);
    const customer = await createCustomer();
    await createOrder(customer.id, ticket.id);
    const pending = await createOrder(customer.id, ticket.id, {
      paymentStatus: PaymentStatus.WAITING_FOR_CONFIRMATION,
    });

    const response = await getTransactions(
      { status: PaymentStatus.WAITING_FOR_CONFIRMATION },
      signAccessToken(user),
    );

    expect(response.status).toBe(200);
    expect(response.body.meta.total).toBe(1);
    expect(response.body.data[0].id).toBe(pending.id);
  });

  it("should ignore an unknown status value", async () => {
    const { user, organization } = await createOrganizer();
    const { ticket } = await createEvent(organization.id);
    const customer = await createCustomer();
    await createOrder(customer.id, ticket.id);
    await createOrder(customer.id, ticket.id, {
      paymentStatus: PaymentStatus.PAID,
    });

    const response = await getTransactions(
      { status: "NOT_A_STATUS" },
      signAccessToken(user),
    );

    expect(response.status).toBe(200);
    expect(response.body.meta.total).toBe(2);
  });

  it("should filter by event id", async () => {
    const { user, organization } = await createOrganizer();
    const concert = await createEvent(organization.id, { name: "Concert" });
    const workshop = await createEvent(organization.id, { name: "Workshop" });
    const customer = await createCustomer();
    await createOrder(customer.id, concert.ticket.id);
    const workshopOrder = await createOrder(customer.id, workshop.ticket.id);

    const response = await getTransactions(
      { eventId: workshop.event.id },
      signAccessToken(user),
    );

    expect(response.status).toBe(200);
    expect(response.body.meta.total).toBe(1);
    expect(response.body.data[0].id).toBe(workshopOrder.id);
  });

  it("should search by customer name or email, case-insensitively", async () => {
    const { user, organization } = await createOrganizer();
    const { ticket } = await createEvent(organization.id);
    const budi = await createCustomer({ name: "Budi Santoso", email: "budi@mail.com" });
    const sari = await createCustomer({ name: "Sari Dewi", email: "sari@mail.com" });
    const budiOrder = await createOrder(budi.id, ticket.id);
    const sariOrder = await createOrder(sari.id, ticket.id);

    const byName = await getTransactions({ search: "budi" }, signAccessToken(user));
    expect(byName.status).toBe(200);
    expect(byName.body.data.map((order: { id: number }) => order.id)).toEqual([
      budiOrder.id,
    ]);

    const byEmail = await getTransactions(
      { search: "SARI@mail" },
      signAccessToken(user),
    );
    expect(byEmail.body.data.map((order: { id: number }) => order.id)).toEqual([
      sariOrder.id,
    ]);
  });

  it("should sort by the requested column and order", async () => {
    const { user, organization } = await createOrganizer();
    const { ticket } = await createEvent(organization.id);
    const customer = await createCustomer();
    const cheap = await createOrder(customer.id, ticket.id, { total: 50_000 });
    const expensive = await createOrder(customer.id, ticket.id, { total: 300_000 });

    const response = await getTransactions(
      { sortBy: "finalPrice", sortOrder: "asc" },
      signAccessToken(user),
    );

    expect(response.status).toBe(200);
    expect(response.body.data.map((order: { id: number }) => order.id)).toEqual([
      cheap.id,
      expensive.id,
    ]);
  });

  it("should return an empty list when the organizer has no transactions", async () => {
    const { user, organization } = await createOrganizer();
    await createEvent(organization.id);

    const response = await getTransactions({}, signAccessToken(user));

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual([]);
    expect(response.body.meta.total).toBe(0);
  });

  it("should return 404 when the organizer has no organization", async () => {
    const organizerWithoutOrganization = await createUser({
      role: Role.ORGANIZER,
    });

    const response = await getTransactions(
      {},
      signAccessToken(organizerWithoutOrganization),
    );

    expect(response.status).toBe(404);
    expect(response.body.message).toBe("Organization not found");
  });

  it("should return 403 when a customer requests organizer transactions", async () => {
    const customer = await createCustomer();

    const response = await getTransactions({}, signAccessToken(customer));

    expect(response.status).toBe(403);
    expect(response.body.message).toBe("Forbidden");
  });

  it("should return 401 when no token is provided", async () => {
    const response = await getTransactions();

    expect(response.status).toBe(401);
    expect(response.body.message).toBe("Token not provided");
  });

  it("should return 401 for an invalid token", async () => {
    const response = await getTransactions({}, "not-a-token");

    expect(response.status).toBe(401);
    expect(response.body.message).toBe("Invalid token");
  });

  it("should return 401 for an expired token", async () => {
    const { user } = await createOrganizer();

    const response = await getTransactions({}, signExpiredToken(user));

    expect(response.status).toBe(401);
    expect(response.body.message).toBe("Token expired");
  });
});
