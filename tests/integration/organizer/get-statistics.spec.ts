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

function getStatistics(query: object = {}, token?: string) {
  const req = request(app).get("/api/organizer/statistics").query(query);

  if (token !== undefined) {
    req.set("Authorization", `Bearer ${token}`);
  }

  return req;
}

type StatRow = { label: string; tickets: number; revenue: number };

/** Noon local time, so the day never shifts when converted to UTC and back. */
function localNoon(year: number, month: number, day: number) {
  return new Date(year, month - 1, day, 12, 0, 0);
}

describe("GET /organizer/statistics", () => {
  it("should summarize paid orders and group them by year, month and day", async () => {
    const { user, organization } = await createOrganizer();
    const { ticket } = await createEvent(organization.id);
    await createEvent(organization.id);
    const customer = await createCustomer();

    await createPaidOrder(customer.id, ticket.id, {
      quantity: 2,
      total: 200_000,
      paidAt: localNoon(2026, 3, 5),
    });
    await createPaidOrder(customer.id, ticket.id, {
      quantity: 1,
      total: 150_000,
      paidAt: localNoon(2026, 3, 20),
    });
    await createPaidOrder(customer.id, ticket.id, {
      quantity: 3,
      total: 300_000,
      paidAt: localNoon(2026, 7, 1),
    });
    await createPaidOrder(customer.id, ticket.id, {
      quantity: 1,
      total: 50_000,
      paidAt: localNoon(2025, 12, 31),
    });

    const response = await getStatistics(
      { year: 2026, month: 3 },
      signAccessToken(user),
    );

    expect(response.status).toBe(200);
    expect(response.body.year).toBe(2026);
    expect(response.body.month).toBe(3);
    expect(response.body.summary).toEqual({
      totalEvents: 2,
      totalOrders: 4,
      totalTickets: 7,
      totalRevenue: 700_000,
    });

    expect(response.body.byYear).toEqual(
      expect.arrayContaining([
        { label: "2025", tickets: 1, revenue: 50_000 },
        { label: "2026", tickets: 6, revenue: 650_000 },
      ]),
    );
    expect(response.body.byYear).toHaveLength(2);

    const byMonth: StatRow[] = response.body.byMonth;
    expect(byMonth).toHaveLength(12);
    expect(byMonth[2]).toEqual({ label: "Mar", tickets: 3, revenue: 350_000 });
    expect(byMonth[6]).toEqual({ label: "Jul", tickets: 3, revenue: 300_000 });
    expect(byMonth[0]).toEqual({ label: "Jan", tickets: 0, revenue: 0 });

    const byDay: StatRow[] = response.body.byDay;
    expect(byDay).toHaveLength(31);
    expect(byDay[4]).toEqual({ label: "5", tickets: 2, revenue: 200_000 });
    expect(byDay[19]).toEqual({ label: "20", tickets: 1, revenue: 150_000 });
    expect(byDay[0]).toEqual({ label: "1", tickets: 0, revenue: 0 });
  });

  it("should only count PAID orders", async () => {
    const { user, organization } = await createOrganizer();
    const { ticket } = await createEvent(organization.id);
    const customer = await createCustomer();
    await createPaidOrder(customer.id, ticket.id, { total: 100_000 });
    for (const paymentStatus of [
      PaymentStatus.WAITING_FOR_PAYMENT,
      PaymentStatus.WAITING_FOR_CONFIRMATION,
      PaymentStatus.REJECTED,
      PaymentStatus.EXPIRED,
      PaymentStatus.CANCELED,
    ]) {
      await createOrder(customer.id, ticket.id, { total: 999_999, paymentStatus });
    }

    const response = await getStatistics({}, signAccessToken(user));

    expect(response.status).toBe(200);
    expect(response.body.summary).toMatchObject({
      totalOrders: 1,
      totalTickets: 1,
      totalRevenue: 100_000,
    });
  });

  it("should only count the authenticated organizer's events and orders", async () => {
    const acme = await createOrganizer({ organizationName: "Acme" });
    const globex = await createOrganizer({ organizationName: "Globex" });
    const acmeEvent = await createEvent(acme.organization.id);
    const globexEvent = await createEvent(globex.organization.id);
    const customer = await createCustomer();
    await createPaidOrder(customer.id, acmeEvent.ticket.id, { total: 100_000 });
    await createPaidOrder(customer.id, globexEvent.ticket.id, { total: 500_000 });

    const response = await getStatistics({}, signAccessToken(acme.user));

    expect(response.status).toBe(200);
    expect(response.body.summary).toEqual({
      totalEvents: 1,
      totalOrders: 1,
      totalTickets: 1,
      totalRevenue: 100_000,
    });
  });

  it("should not count deleted events in totalEvents", async () => {
    const { user, organization } = await createOrganizer();
    await createEvent(organization.id);
    await createEvent(organization.id, { deletedAt: new Date() });

    const response = await getStatistics({}, signAccessToken(user));

    expect(response.status).toBe(200);
    expect(response.body.summary.totalEvents).toBe(1);
  });

  it("should default to the current year and month", async () => {
    const { user } = await createOrganizer();
    const now = new Date();

    const response = await getStatistics({}, signAccessToken(user));

    expect(response.status).toBe(200);
    expect(response.body.year).toBe(now.getFullYear());
    expect(response.body.month).toBe(now.getMonth() + 1);
    expect(response.body.byDay).toHaveLength(
      new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate(),
    );
  });

  it("should fall back to the defaults when year and month are not numbers", async () => {
    const { user } = await createOrganizer();
    const now = new Date();

    const response = await getStatistics(
      { year: "abc", month: "xyz" },
      signAccessToken(user),
    );

    expect(response.status).toBe(200);
    expect(response.body.year).toBe(now.getFullYear());
    expect(response.body.month).toBe(now.getMonth() + 1);
  });

  it("should return the right number of days for February", async () => {
    const { user } = await createOrganizer();

    const leapYear = await getStatistics(
      { year: 2028, month: 2 },
      signAccessToken(user),
    );
    expect(leapYear.body.byDay).toHaveLength(29);

    const normalYear = await getStatistics(
      { year: 2027, month: 2 },
      signAccessToken(user),
    );
    expect(normalYear.body.byDay).toHaveLength(28);
  });

  it("should return zeroed statistics when the organizer has no orders", async () => {
    const { user } = await createOrganizer();

    const response = await getStatistics({}, signAccessToken(user));

    expect(response.status).toBe(200);
    expect(response.body.summary).toEqual({
      totalEvents: 0,
      totalOrders: 0,
      totalTickets: 0,
      totalRevenue: 0,
    });
    expect(response.body.byYear).toEqual([]);
    expect(
      response.body.byMonth.every(
        (row: StatRow) => row.tickets === 0 && row.revenue === 0,
      ),
    ).toBe(true);
  });

  it("should return 404 when the organizer has no organization", async () => {
    const organizerWithoutOrganization = await createUser({
      role: Role.ORGANIZER,
    });

    const response = await getStatistics(
      {},
      signAccessToken(organizerWithoutOrganization),
    );

    expect(response.status).toBe(404);
    expect(response.body.message).toBe("Organization not found");
  });

  it("should return 403 when a customer requests the statistics", async () => {
    const customer = await createCustomer();

    const response = await getStatistics({}, signAccessToken(customer));

    expect(response.status).toBe(403);
    expect(response.body.message).toBe("Forbidden");
  });

  it("should return 401 when no token is provided", async () => {
    const response = await getStatistics();

    expect(response.status).toBe(401);
    expect(response.body.message).toBe("Token not provided");
  });

  it("should return 401 for an expired token", async () => {
    const { user } = await createOrganizer();

    const response = await getStatistics({}, signExpiredToken(user));

    expect(response.status).toBe(401);
    expect(response.body.message).toBe("Token expired");
  });
});
