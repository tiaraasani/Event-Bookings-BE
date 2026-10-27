import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "../../../src/app.js";
import {
  DAY_IN_MS,
  createCustomer,
  createEvent,
  createOrganizer,
  createPaidOrder,
  createVoucher,
} from "../../helpers/factories.js";

function getPublicPromotions() {
  return request(app).get("/api/vouchers/public");
}

describe("GET /vouchers/public", () => {
  it("should return active vouchers with their event summary, ordered by the soonest end date", async () => {
    const { organization } = await createOrganizer();
    const { event } = await createEvent(organization.id, { name: "Expo" });
    const endsLater = await createVoucher(event.id, {
      code: "LATER",
      endDate: new Date(Date.now() + 20 * DAY_IN_MS),
    });
    const endsSoon = await createVoucher(event.id, {
      code: "SOON",
      endDate: new Date(Date.now() + 2 * DAY_IN_MS),
    });

    const response = await getPublicPromotions();

    expect(response.status).toBe(200);
    expect(response.body.message).toBe("Promotions retrieved successfully");
    expect(response.body.data.map((voucher: { id: number }) => voucher.id)).toEqual([
      endsSoon.id,
      endsLater.id,
    ]);
    expect(response.body.data[0]).toMatchObject({
      code: "SOON",
      event: {
        id: event.id,
        name: "Expo",
        slug: event.slug,
        city: "Jakarta",
      },
      _count: { orders: 0 },
    });
  });

  it("should not return vouchers that have not started yet", async () => {
    const { organization } = await createOrganizer();
    const { event } = await createEvent(organization.id);
    await createVoucher(event.id, {
      code: "FUTURE",
      startDate: new Date(Date.now() + DAY_IN_MS),
      endDate: new Date(Date.now() + 10 * DAY_IN_MS),
    });

    const response = await getPublicPromotions();

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual([]);
  });

  it("should not return vouchers that have already ended", async () => {
    const { organization } = await createOrganizer();
    const { event } = await createEvent(organization.id);
    await createVoucher(event.id, {
      code: "PAST",
      startDate: new Date(Date.now() - 10 * DAY_IN_MS),
      endDate: new Date(Date.now() - DAY_IN_MS),
    });

    const response = await getPublicPromotions();

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual([]);
  });

  it("should not return vouchers whose quota has been used up", async () => {
    const { organization } = await createOrganizer();
    const { event, ticket } = await createEvent(organization.id);
    const customer = await createCustomer();
    const soldOut = await createVoucher(event.id, { code: "SOLDOUT", quota: 2 });
    await createPaidOrder(customer.id, ticket.id, { voucherId: soldOut.id });
    await createPaidOrder(customer.id, ticket.id, { voucherId: soldOut.id });
    const available = await createVoucher(event.id, { code: "OPEN", quota: 2 });
    await createPaidOrder(customer.id, ticket.id, { voucherId: available.id });

    const response = await getPublicPromotions();

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0]).toMatchObject({
      code: "OPEN",
      _count: { orders: 1 },
    });
  });

  it("should not return vouchers of deleted events", async () => {
    const { organization } = await createOrganizer();
    const { event } = await createEvent(organization.id, {
      deletedAt: new Date(),
    });
    await createVoucher(event.id, { code: "DELETED" });

    const response = await getPublicPromotions();

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual([]);
  });

  it("should return an empty list when there are no vouchers", async () => {
    const response = await getPublicPromotions();

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual([]);
  });

  it("should be accessible without a token", async () => {
    const response = await getPublicPromotions();

    expect(response.status).toBe(200);
  });
});
