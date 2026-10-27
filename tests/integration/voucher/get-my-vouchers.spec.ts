import request from "supertest";
import { describe, expect, it } from "vitest";
import { prisma } from "../../../src/lib/prisma.js";
import { app } from "../../../src/app.js";
import { Role } from "../../../src/generated/prisma/enums.js";
import {
  createCustomer,
  createEvent,
  createOrganizer,
  createPaidOrder,
  createUser,
  createVoucher,
  signAccessToken,
  signExpiredToken,
} from "../../helpers/factories.js";

function getMyVouchers(token?: string) {
  const req = request(app).get("/api/vouchers");

  if (token !== undefined) {
    req.set("Authorization", `Bearer ${token}`);
  }

  return req;
}

describe("GET /vouchers", () => {
  it("should return the organizer's vouchers with event details and usage count, newest first", async () => {
    const { user, organization } = await createOrganizer();
    const { event, ticket } = await createEvent(organization.id, { name: "Expo" });
    const customer = await createCustomer();

    const older = await createVoucher(event.id, { code: "OLDER", quota: 5 });
    await prisma.voucher.update({
      where: { id: older.id },
      data: { createdAt: new Date(Date.now() - 60_000) },
    });
    const newer = await createVoucher(event.id, { code: "NEWER", quota: 8 });
    await createPaidOrder(customer.id, ticket.id, { voucherId: newer.id });
    await createPaidOrder(customer.id, ticket.id, { voucherId: newer.id });

    const response = await getMyVouchers(signAccessToken(user));

    expect(response.status).toBe(200);
    expect(response.body.message).toBe("Vouchers retrieved successfully");
    expect(response.body.data).toHaveLength(2);
    expect(response.body.data[0]).toMatchObject({
      id: newer.id,
      code: "NEWER",
      quota: 8,
      event: {
        id: event.id,
        name: "Expo",
        startDate: event.startDate.toISOString(),
        endDate: event.endDate.toISOString(),
      },
      _count: { orders: 2 },
    });
    expect(response.body.data[1]).toMatchObject({
      id: older.id,
      code: "OLDER",
      _count: { orders: 0 },
    });
  });

  it("should only return vouchers of the authenticated organizer's events", async () => {
    const acme = await createOrganizer({ organizationName: "Acme" });
    const globex = await createOrganizer({ organizationName: "Globex" });
    const acmeEvent = await createEvent(acme.organization.id);
    const globexEvent = await createEvent(globex.organization.id);
    await createVoucher(acmeEvent.event.id, { code: "ACME" });
    await createVoucher(globexEvent.event.id, { code: "GLOBEX" });

    const response = await getMyVouchers(signAccessToken(acme.user));

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0].code).toBe("ACME");
  });

  it("should return an empty list when the organizer has no vouchers", async () => {
    const { user, organization } = await createOrganizer();
    await createEvent(organization.id);

    const response = await getMyVouchers(signAccessToken(user));

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual([]);
  });

  it("should return 404 when the organizer has no organization", async () => {
    const organizerWithoutOrganization = await createUser({
      role: Role.ORGANIZER,
    });

    const response = await getMyVouchers(
      signAccessToken(organizerWithoutOrganization),
    );

    expect(response.status).toBe(404);
    expect(response.body.message).toBe("Organization not found");
  });

  it("should return 403 when a customer requests the voucher list", async () => {
    const customer = await createCustomer();

    const response = await getMyVouchers(signAccessToken(customer));

    expect(response.status).toBe(403);
    expect(response.body.message).toBe("Only organizers can manage vouchers");
  });

  it("should return 401 when no token is provided", async () => {
    const response = await getMyVouchers();

    expect(response.status).toBe(401);
    expect(response.body.message).toBe("Token not provided");
  });

  it("should return 401 for an invalid token", async () => {
    const response = await getMyVouchers("not-a-token");

    expect(response.status).toBe(401);
    expect(response.body.message).toBe("Invalid token");
  });

  it("should return 401 for an expired token", async () => {
    const { user } = await createOrganizer();

    const response = await getMyVouchers(signExpiredToken(user));

    expect(response.status).toBe(401);
    expect(response.body.message).toBe("Token expired");
  });
});
