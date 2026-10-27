import request from "supertest";
import { describe, expect, it } from "vitest";
import { PaymentStatus, Role } from "../../../src/generated/prisma/enums.js";
import { app } from "../../../src/app.js";
import {
  createCustomer,
  createEvent,
  createOrder,
  createOrganizer,
  createPaidOrder,
  createUser,
  signAccessToken,
  signExpiredToken,
} from "../../helpers/factories.js";

function getEventAttendees(
  eventId: number | string,
  query: object = {},
  token?: string,
) {
  const req = request(app)
    .get(`/api/organizer/events/${eventId}/attendees`)
    .query(query);

  if (token !== undefined) {
    req.set("Authorization", `Bearer ${token}`);
  }

  return req;
}

describe("GET /organizer/events/:id/attendees", () => {
  it("should return the paid attendees of the event with a summary, earliest payment first", async () => {
    const { user, organization } = await createOrganizer();
    const { event, ticket } = await createEvent(organization.id, {
      name: "Jakarta Music Fest",
      tickets: [{ name: "VIP", price: 250_000 }],
    });
    const budi = await createCustomer({ name: "Budi", email: "budi@mail.com" });
    const sari = await createCustomer({ name: "Sari", email: "sari@mail.com" });
    const later = await createPaidOrder(sari.id, ticket.id, {
      quantity: 1,
      total: 250_000,
      paidAt: new Date(Date.now() - 1_000),
    });
    const earlier = await createPaidOrder(budi.id, ticket.id, {
      quantity: 2,
      total: 500_000,
      paidAt: new Date(Date.now() - 60_000),
    });

    const response = await getEventAttendees(event.id, {}, signAccessToken(user));

    expect(response.status).toBe(200);
    expect(response.body.event).toEqual({
      id: event.id,
      name: "Jakarta Music Fest",
      startDate: event.startDate.toISOString(),
    });
    expect(response.body.summary).toEqual({
      totalAttendees: 2,
      totalTickets: 3,
      totalRevenue: 750_000,
    });
    expect(response.body.meta).toEqual({ page: 1, take: 10, total: 2 });
    expect(response.body.attendees).toEqual([
      {
        orderId: earlier.id,
        name: "Budi",
        email: "budi@mail.com",
        ticketName: "VIP",
        quantity: 2,
        totalPaid: 500_000,
        paidAt: earlier.paidAt!.toISOString(),
      },
      {
        orderId: later.id,
        name: "Sari",
        email: "sari@mail.com",
        ticketName: "VIP",
        quantity: 1,
        totalPaid: 250_000,
        paidAt: later.paidAt!.toISOString(),
      },
    ]);
  });

  it("should only include PAID orders", async () => {
    const { user, organization } = await createOrganizer();
    const { event, ticket } = await createEvent(organization.id);
    const customer = await createCustomer();
    const paid = await createPaidOrder(customer.id, ticket.id);
    for (const paymentStatus of [
      PaymentStatus.WAITING_FOR_PAYMENT,
      PaymentStatus.WAITING_FOR_CONFIRMATION,
      PaymentStatus.REJECTED,
      PaymentStatus.EXPIRED,
      PaymentStatus.CANCELED,
    ]) {
      await createOrder(customer.id, ticket.id, { paymentStatus });
    }

    const response = await getEventAttendees(event.id, {}, signAccessToken(user));

    expect(response.status).toBe(200);
    expect(response.body.summary.totalAttendees).toBe(1);
    expect(response.body.attendees).toHaveLength(1);
    expect(response.body.attendees[0].orderId).toBe(paid.id);
  });

  it("should only include orders of the requested event", async () => {
    const { user, organization } = await createOrganizer();
    const concert = await createEvent(organization.id);
    const workshop = await createEvent(organization.id);
    const customer = await createCustomer();
    const concertOrder = await createPaidOrder(customer.id, concert.ticket.id);
    await createPaidOrder(customer.id, workshop.ticket.id);

    const response = await getEventAttendees(
      concert.event.id,
      {},
      signAccessToken(user),
    );

    expect(response.status).toBe(200);
    expect(response.body.attendees).toHaveLength(1);
    expect(response.body.attendees[0].orderId).toBe(concertOrder.id);
  });

  it("should paginate the attendees while keeping the full summary", async () => {
    const { user, organization } = await createOrganizer();
    const { event, ticket } = await createEvent(organization.id);
    const customer = await createCustomer();
    for (let i = 0; i < 5; i++) {
      await createPaidOrder(customer.id, ticket.id, {
        paidAt: new Date(Date.now() - i * 1_000),
      });
    }

    const response = await getEventAttendees(
      event.id,
      { page: 2, take: 2 },
      signAccessToken(user),
    );

    expect(response.status).toBe(200);
    expect(response.body.attendees).toHaveLength(2);
    expect(response.body.meta).toEqual({ page: 2, take: 2, total: 5 });
    expect(response.body.summary).toEqual({
      totalAttendees: 5,
      totalTickets: 5,
      totalRevenue: 500_000,
    });
  });

  it("should return an empty attendee list when nobody has paid yet", async () => {
    const { user, organization } = await createOrganizer();
    const { event } = await createEvent(organization.id);

    const response = await getEventAttendees(event.id, {}, signAccessToken(user));

    expect(response.status).toBe(200);
    expect(response.body.attendees).toEqual([]);
    expect(response.body.summary).toEqual({
      totalAttendees: 0,
      totalTickets: 0,
      totalRevenue: 0,
    });
  });

  it("should return 404 when the event belongs to another organizer", async () => {
    const { organization } = await createOrganizer();
    const { event } = await createEvent(organization.id);
    const other = await createOrganizer({ organizationName: "Globex" });

    const response = await getEventAttendees(
      event.id,
      {},
      signAccessToken(other.user),
    );

    expect(response.status).toBe(404);
    expect(response.body.message).toBe("Event not found");
  });

  it("should return 404 when the event has been deleted", async () => {
    const { user, organization } = await createOrganizer();
    const { event } = await createEvent(organization.id, {
      deletedAt: new Date(),
    });

    const response = await getEventAttendees(event.id, {}, signAccessToken(user));

    expect(response.status).toBe(404);
    expect(response.body.message).toBe("Event not found");
  });

  it("should return 404 when the event does not exist", async () => {
    const { user } = await createOrganizer();

    const response = await getEventAttendees(999_999, {}, signAccessToken(user));

    expect(response.status).toBe(404);
    expect(response.body.message).toBe("Event not found");
  });

  it("should return 404 when the organizer has no organization", async () => {
    const organizerWithoutOrganization = await createUser({
      role: Role.ORGANIZER,
    });

    const response = await getEventAttendees(
      1,
      {},
      signAccessToken(organizerWithoutOrganization),
    );

    expect(response.status).toBe(404);
    expect(response.body.message).toBe("Organization not found");
  });

  it("should return 403 when a customer requests the attendees", async () => {
    const customer = await createCustomer();

    const response = await getEventAttendees(1, {}, signAccessToken(customer));

    expect(response.status).toBe(403);
    expect(response.body.message).toBe("Forbidden");
  });

  it("should return 401 when no token is provided", async () => {
    const response = await getEventAttendees(1);

    expect(response.status).toBe(401);
    expect(response.body.message).toBe("Token not provided");
  });

  it("should return 401 for an expired token", async () => {
    const { user } = await createOrganizer();

    const response = await getEventAttendees(1, {}, signExpiredToken(user));

    expect(response.status).toBe(401);
    expect(response.body.message).toBe("Token expired");
  });
});
