import request from "supertest";
import { describe, expect, it } from "vitest";
import { Role } from "../../../src/generated/prisma/enums.js";
import { app } from "../../../src/app.js";
import {
  DAY_IN_MS,
  createCoupon,
  createCustomer,
  createOrganizer,
  createPoint,
  signAccessToken,
  signExpiredToken,
} from "../../helpers/factories.js";

function getProfile(token?: string) {
  const req = request(app).get("/api/profile");

  if (token !== undefined) {
    req.set("Authorization", `Bearer ${token}`);
  }

  return req;
}

describe("GET /profile", () => {
  it("should return the customer's profile with point balance and coupons", async () => {
    const customer = await createCustomer({ name: "Budi Santoso" });
    await createPoint(customer.id, { amount: 10_000 });
    await createPoint(customer.id, { amount: 5_000 });
    const coupon = await createCoupon(customer.id, { discountValue: 10_000 });

    const response = await getProfile(signAccessToken(customer));

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      id: customer.id,
      name: "Budi Santoso",
      email: customer.email,
      role: Role.CUSTOMER,
      referralCode: customer.referralCode,
      picture: null,
      organization: null,
      pointBalance: 15_000,
    });
    expect(response.body.coupons).toHaveLength(1);
    expect(response.body.coupons[0]).toMatchObject({
      id: coupon.id,
      code: coupon.code,
      discountValue: 10_000,
      isUsed: false,
    });
  });

  it("should not expose the password hash", async () => {
    const customer = await createCustomer();

    const response = await getProfile(signAccessToken(customer));

    expect(response.status).toBe(200);
    expect(response.body).not.toHaveProperty("password");
  });

  it("should include the organization for an organizer", async () => {
    const { user, organization } = await createOrganizer({
      organizationName: "Acme Events",
    });

    const response = await getProfile(signAccessToken(user));

    expect(response.status).toBe(200);
    expect(response.body.role).toBe(Role.ORGANIZER);
    expect(response.body.organization).toMatchObject({
      id: organization.id,
      name: "Acme Events",
    });
  });

  it("should exclude expired points from the balance", async () => {
    const customer = await createCustomer();
    await createPoint(customer.id, { amount: 10_000 });
    await createPoint(customer.id, {
      amount: 7_000,
      expiresAt: new Date(Date.now() - DAY_IN_MS),
    });

    const response = await getProfile(signAccessToken(customer));

    expect(response.status).toBe(200);
    expect(response.body.pointBalance).toBe(10_000);
  });

  it("should only list unused, unexpired coupons, soonest expiry first", async () => {
    const customer = await createCustomer();
    const later = await createCoupon(customer.id, {
      expiresAt: new Date(Date.now() + 60 * DAY_IN_MS),
    });
    const soon = await createCoupon(customer.id, {
      expiresAt: new Date(Date.now() + 5 * DAY_IN_MS),
    });
    await createCoupon(customer.id, { isUsed: true });
    await createCoupon(customer.id, {
      expiresAt: new Date(Date.now() - DAY_IN_MS),
    });

    const response = await getProfile(signAccessToken(customer));

    expect(response.status).toBe(200);
    expect(response.body.coupons.map((coupon: { id: number }) => coupon.id)).toEqual([
      soon.id,
      later.id,
    ]);
  });

  it("should not include another user's points or coupons", async () => {
    const customer = await createCustomer();
    const other = await createCustomer();
    await createPoint(other.id, { amount: 10_000 });
    await createCoupon(other.id);

    const response = await getProfile(signAccessToken(customer));

    expect(response.status).toBe(200);
    expect(response.body.pointBalance).toBe(0);
    expect(response.body.coupons).toEqual([]);
  });

  it("should return a zero balance and no coupons for a new user", async () => {
    const customer = await createCustomer();

    const response = await getProfile(signAccessToken(customer));

    expect(response.status).toBe(200);
    expect(response.body.pointBalance).toBe(0);
    expect(response.body.coupons).toEqual([]);
  });

  it("should return 404 when the user in the token no longer exists", async () => {
    const response = await getProfile(
      signAccessToken({ id: 999_999, role: Role.CUSTOMER }),
    );

    expect(response.status).toBe(404);
    expect(response.body.message).toBe("User not found");
  });

  it("should return 401 when no token is provided", async () => {
    const response = await getProfile();

    expect(response.status).toBe(401);
    expect(response.body.message).toBe("Token not provided");
  });

  it("should return 401 for an invalid token", async () => {
    const response = await getProfile("not-a-token");

    expect(response.status).toBe(401);
    expect(response.body.message).toBe("Invalid token");
  });

  it("should return 401 for an expired token", async () => {
    const customer = await createCustomer();

    const response = await getProfile(signExpiredToken(customer));

    expect(response.status).toBe(401);
    expect(response.body.message).toBe("Token expired");
  });
});
