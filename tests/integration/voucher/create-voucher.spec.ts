import request from "supertest";
import { describe, expect, it } from "vitest";
import { prisma } from "../../../src/lib/prisma.js";
import { app } from "../../../src/app.js";
import {
  DAY_IN_MS,
  createCustomer,
  createEvent,
  createOrganizer,
  createUser,
  createVoucher,
  signAccessToken,
  signExpiredToken,
} from "../../helpers/factories.js";
import { Role } from "../../../src/generated/prisma/enums.js";

function buildVoucherPayload(eventId: number, overrides: object = {}) {
  return {
    eventId,
    code: "EARLYBIRD",
    discountValue: 20,
    quota: 50,
    startDate: new Date().toISOString(),
    endDate: new Date(Date.now() + 14 * DAY_IN_MS).toISOString(),
    ...overrides,
  };
}

function postVoucher(payload: object, token?: string) {
  const req = request(app).post("/api/vouchers");

  if (token !== undefined) {
    req.set("Authorization", `Bearer ${token}`);
  }

  return req.send(payload);
}

describe("POST /vouchers", () => {
  it("should create a voucher for the organizer's own event", async () => {
    const { user, organization } = await createOrganizer();
    const { event } = await createEvent(organization.id, { name: "Expo" });
    const payload = buildVoucherPayload(event.id);

    const response = await postVoucher(payload, signAccessToken(user));

    expect(response.status).toBe(201);
    expect(response.body.message).toBe("Voucher created successfully");
    expect(response.body.data).toMatchObject({
      eventId: event.id,
      code: "EARLYBIRD",
      discountValue: 20,
      quota: 50,
      startDate: payload.startDate,
      endDate: payload.endDate,
      event: { id: event.id, name: "Expo" },
    });

    const voucher = await prisma.voucher.findUnique({
      where: { code: "EARLYBIRD" },
    });
    expect(voucher?.eventId).toBe(event.id);
  });

  it("should normalize the code to uppercase and trim it", async () => {
    const { user, organization } = await createOrganizer();
    const { event } = await createEvent(organization.id);

    const response = await postVoucher(
      buildVoucherPayload(event.id, { code: "  promo10 " }),
      signAccessToken(user),
    );

    expect(response.status).toBe(201);
    expect(response.body.data.code).toBe("PROMO10");
    expect(await prisma.voucher.count({ where: { code: "PROMO10" } })).toBe(1);
  });

  it("should return 409 when the code already exists, even in a different case", async () => {
    const { user, organization } = await createOrganizer();
    const { event } = await createEvent(organization.id);
    await createVoucher(event.id, { code: "TAKEN" });

    const response = await postVoucher(
      buildVoucherPayload(event.id, { code: "taken" }),
      signAccessToken(user),
    );

    expect(response.status).toBe(409);
    expect(response.body.message).toBe("Voucher code already exists");
    expect(await prisma.voucher.count()).toBe(1);
  });

  it("should return 404 when the event belongs to another organizer", async () => {
    const { user } = await createOrganizer();
    const other = await createOrganizer({ organizationName: "Globex" });
    const { event } = await createEvent(other.organization.id);

    const response = await postVoucher(
      buildVoucherPayload(event.id),
      signAccessToken(user),
    );

    expect(response.status).toBe(404);
    expect(response.body.message).toBe("Event not found or not owned by you");
    expect(await prisma.voucher.count()).toBe(0);
  });

  it("should return 404 when the event has been deleted", async () => {
    const { user, organization } = await createOrganizer();
    const { event } = await createEvent(organization.id, {
      deletedAt: new Date(),
    });

    const response = await postVoucher(
      buildVoucherPayload(event.id),
      signAccessToken(user),
    );

    expect(response.status).toBe(404);
  });

  it("should return 404 when the organizer has no organization", async () => {
    const organizerWithoutOrganization = await createUser({
      role: Role.ORGANIZER,
    });

    const response = await postVoucher(
      buildVoucherPayload(1),
      signAccessToken(organizerWithoutOrganization),
    );

    expect(response.status).toBe(404);
    expect(response.body.message).toBe("Organization not found");
  });

  it("should return 400 when the end date is in the past", async () => {
    const { user, organization } = await createOrganizer();
    const { event } = await createEvent(organization.id);

    const response = await postVoucher(
      buildVoucherPayload(event.id, {
        startDate: new Date(Date.now() - 5 * DAY_IN_MS).toISOString(),
        endDate: new Date(Date.now() - DAY_IN_MS).toISOString(),
      }),
      signAccessToken(user),
    );

    expect(response.status).toBe(400);
    expect(response.body.message).toBe(
      "Voucher end date must be in the future",
    );
  });

  it("should return 400 when the end date is before the start date", async () => {
    const { user, organization } = await createOrganizer();
    const { event } = await createEvent(organization.id);

    const response = await postVoucher(
      buildVoucherPayload(event.id, {
        startDate: new Date(Date.now() + 10 * DAY_IN_MS).toISOString(),
        endDate: new Date(Date.now() + 5 * DAY_IN_MS).toISOString(),
      }),
      signAccessToken(user),
    );

    expect(response.status).toBe(400);
    expect(response.body.message).toContain("End date must be after start date");
  });

  it.each([
    ["a code shorter than 3 characters", { code: "AB" }],
    ["a discount of 0", { discountValue: 0 }],
    ["a discount above 100", { discountValue: 101 }],
    ["a non-integer discount", { discountValue: 12.5 }],
    ["a quota of 0", { quota: 0 }],
    ["an event id sent as a string", { eventId: "1" }],
    ["an invalid date", { startDate: "not-a-date" }],
    ["a missing code", { code: undefined }],
  ])("should return 400 for %s", async (_label, overrides) => {
    const { user, organization } = await createOrganizer();
    const { event } = await createEvent(organization.id);

    const response = await postVoucher(
      buildVoucherPayload(event.id, overrides),
      signAccessToken(user),
    );

    expect(response.status).toBe(400);
    expect(await prisma.voucher.count()).toBe(0);
  });

  it("should return 403 when a customer tries to create a voucher", async () => {
    const customer = await createCustomer();

    const response = await postVoucher(
      buildVoucherPayload(1),
      signAccessToken(customer),
    );

    expect(response.status).toBe(403);
    expect(response.body.message).toBe("Only organizers can manage vouchers");
  });

  it("should return 401 when no token is provided", async () => {
    const response = await postVoucher(buildVoucherPayload(1));

    expect(response.status).toBe(401);
    expect(response.body.message).toBe("Token not provided");
  });

  it("should return 401 for an invalid token", async () => {
    const response = await postVoucher(buildVoucherPayload(1), "not-a-token");

    expect(response.status).toBe(401);
    expect(response.body.message).toBe("Invalid token");
  });

  it("should return 401 for an expired token", async () => {
    const { user } = await createOrganizer();

    const response = await postVoucher(
      buildVoucherPayload(1),
      signExpiredToken(user),
    );

    expect(response.status).toBe(401);
    expect(response.body.message).toBe("Token expired");
  });
});
