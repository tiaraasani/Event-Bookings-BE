import request from "supertest";
import { describe, expect, it } from "vitest";
import { prisma } from "../../../src/lib/prisma.js";
import { app } from "../../../src/app.js";
import {
  DAY_IN_MS,
  createCustomer,
  createEvent,
  createOrganizer,
  createPaidOrder,
  createVoucher,
  signAccessToken,
  signExpiredToken,
} from "../../helpers/factories.js";

function patchVoucher(
  voucherId: number | string,
  payload: object,
  token?: string,
) {
  const req = request(app).patch(`/api/vouchers/${voucherId}`);

  if (token !== undefined) {
    req.set("Authorization", `Bearer ${token}`);
  }

  return req.send(payload);
}

async function createOrganizerWithVoucher() {
  const { user, organization } = await createOrganizer();
  const { event, ticket } = await createEvent(organization.id, { name: "Expo" });
  const voucher = await createVoucher(event.id, {
    code: "ORIGINAL",
    discountValue: 10,
    quota: 10,
    startDate: new Date(Date.now() - DAY_IN_MS),
    endDate: new Date(Date.now() + 10 * DAY_IN_MS),
  });

  return { user, organization, event, ticket, voucher };
}

describe("PATCH /vouchers/:id", () => {
  it("should update the given fields and leave the others unchanged", async () => {
    const { user, event, voucher } = await createOrganizerWithVoucher();
    const newEndDate = new Date(Date.now() + 20 * DAY_IN_MS);

    const response = await patchVoucher(
      voucher.id,
      { discountValue: 25, endDate: newEndDate.toISOString() },
      signAccessToken(user),
    );

    expect(response.status).toBe(200);
    expect(response.body.message).toBe("Voucher updated successfully");
    expect(response.body.data).toMatchObject({
      id: voucher.id,
      code: "ORIGINAL",
      discountValue: 25,
      quota: 10,
      endDate: newEndDate.toISOString(),
      event: { id: event.id, name: "Expo" },
    });

    const updated = await prisma.voucher.findUniqueOrThrow({
      where: { id: voucher.id },
    });
    expect(updated.discountValue).toBe(25);
    expect(updated.quota).toBe(10);
    expect(updated.startDate.getTime()).toBe(voucher.startDate.getTime());
  });

  it("should normalize a new code to uppercase", async () => {
    const { user, voucher } = await createOrganizerWithVoucher();

    const response = await patchVoucher(
      voucher.id,
      { code: " renamed " },
      signAccessToken(user),
    );

    expect(response.status).toBe(200);
    expect(response.body.data.code).toBe("RENAMED");
  });

  it("should accept the voucher's own code again without a conflict", async () => {
    const { user, voucher } = await createOrganizerWithVoucher();

    const response = await patchVoucher(
      voucher.id,
      { code: "original", quota: 12 },
      signAccessToken(user),
    );

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({ code: "ORIGINAL", quota: 12 });
  });

  it("should return 409 when the new code belongs to another voucher", async () => {
    const { user, event, voucher } = await createOrganizerWithVoucher();
    await createVoucher(event.id, { code: "TAKEN" });

    const response = await patchVoucher(
      voucher.id,
      { code: "taken" },
      signAccessToken(user),
    );

    expect(response.status).toBe(409);
    expect(response.body.message).toBe("Voucher code already exists");
  });

  it("should return 400 when the new end date is before the existing start date", async () => {
    const { user, voucher } = await createOrganizerWithVoucher();

    const response = await patchVoucher(
      voucher.id,
      { endDate: new Date(Date.now() - 2 * DAY_IN_MS).toISOString() },
      signAccessToken(user),
    );

    expect(response.status).toBe(400);
    expect(response.body.message).toBe("End date must be after start date");
  });

  it("should return 400 when the new start date is after the existing end date", async () => {
    const { user, voucher } = await createOrganizerWithVoucher();

    const response = await patchVoucher(
      voucher.id,
      { startDate: new Date(Date.now() + 30 * DAY_IN_MS).toISOString() },
      signAccessToken(user),
    );

    expect(response.status).toBe(400);
    expect(response.body.message).toBe("End date must be after start date");
  });

  it("should return 400 when both dates are sent and the end date is not after the start date", async () => {
    const { user, voucher } = await createOrganizerWithVoucher();
    const sameDay = new Date(Date.now() + 5 * DAY_IN_MS).toISOString();

    const response = await patchVoucher(
      voucher.id,
      { startDate: sameDay, endDate: sameDay },
      signAccessToken(user),
    );

    expect(response.status).toBe(400);
    expect(response.body.message).toContain("End date must be after start date");
  });

  it("should return 400 when the quota is lowered below the number of orders using the voucher", async () => {
    const { user, ticket, voucher } = await createOrganizerWithVoucher();
    const customer = await createCustomer();
    await createPaidOrder(customer.id, ticket.id, { voucherId: voucher.id });
    await createPaidOrder(customer.id, ticket.id, { voucherId: voucher.id });
    await createPaidOrder(customer.id, ticket.id, { voucherId: voucher.id });

    const response = await patchVoucher(
      voucher.id,
      { quota: 2 },
      signAccessToken(user),
    );

    expect(response.status).toBe(400);
    expect(response.body.message).toBe(
      "Quota cannot be lower than the number of orders using this voucher",
    );
  });

  it("should allow a quota equal to the number of orders using the voucher", async () => {
    const { user, ticket, voucher } = await createOrganizerWithVoucher();
    const customer = await createCustomer();
    await createPaidOrder(customer.id, ticket.id, { voucherId: voucher.id });
    await createPaidOrder(customer.id, ticket.id, { voucherId: voucher.id });

    const response = await patchVoucher(
      voucher.id,
      { quota: 2 },
      signAccessToken(user),
    );

    expect(response.status).toBe(200);
    expect(response.body.data.quota).toBe(2);
  });

  it.each([
    ["a discount of 0", { discountValue: 0 }],
    ["a discount above 100", { discountValue: 150 }],
    ["a quota of 0", { quota: 0 }],
    ["a code shorter than 3 characters", { code: "AB" }],
    ["an invalid date", { endDate: "soon" }],
  ])("should return 400 for %s", async (_label, payload) => {
    const { user, voucher } = await createOrganizerWithVoucher();

    const response = await patchVoucher(
      voucher.id,
      payload,
      signAccessToken(user),
    );

    expect(response.status).toBe(400);

    const unchanged = await prisma.voucher.findUniqueOrThrow({
      where: { id: voucher.id },
    });
    expect(unchanged).toMatchObject({
      code: "ORIGINAL",
      discountValue: 10,
      quota: 10,
    });
  });

  it("should return 404 when the voucher belongs to another organizer", async () => {
    const { voucher } = await createOrganizerWithVoucher();
    const other = await createOrganizer({ organizationName: "Globex" });

    const response = await patchVoucher(
      voucher.id,
      { quota: 99 },
      signAccessToken(other.user),
    );

    expect(response.status).toBe(404);
    expect(response.body.message).toBe("Voucher not found");

    const unchanged = await prisma.voucher.findUniqueOrThrow({
      where: { id: voucher.id },
    });
    expect(unchanged.quota).toBe(10);
  });

  it("should return 404 when the voucher does not exist", async () => {
    const { user } = await createOrganizer();

    const response = await patchVoucher(
      999_999,
      { quota: 99 },
      signAccessToken(user),
    );

    expect(response.status).toBe(404);
    expect(response.body.message).toBe("Voucher not found");
  });

  it.each(["abc", "0", "-1"])(
    "should return 400 for an invalid voucher id (%s)",
    async (voucherId) => {
      const { user } = await createOrganizer();

      const response = await patchVoucher(
        voucherId,
        { quota: 5 },
        signAccessToken(user),
      );

      expect(response.status).toBe(400);
      expect(response.body.message).toBe("Invalid voucher ID");
    },
  );

  it("should return 403 when a customer tries to update a voucher", async () => {
    const { voucher } = await createOrganizerWithVoucher();
    const customer = await createCustomer();

    const response = await patchVoucher(
      voucher.id,
      { quota: 5 },
      signAccessToken(customer),
    );

    expect(response.status).toBe(403);
    expect(response.body.message).toBe("Only organizers can manage vouchers");
  });

  it("should return 401 when no token is provided", async () => {
    const response = await patchVoucher(1, { quota: 5 });

    expect(response.status).toBe(401);
    expect(response.body.message).toBe("Token not provided");
  });

  it("should return 401 for an expired token", async () => {
    const { user } = await createOrganizer();

    const response = await patchVoucher(
      1,
      { quota: 5 },
      signExpiredToken(user),
    );

    expect(response.status).toBe(401);
    expect(response.body.message).toBe("Token expired");
  });
});
