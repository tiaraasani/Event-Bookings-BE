import request from "supertest";
import { describe, expect, it } from "vitest";
import { Role } from "../../../src/generated/prisma/enums.js";
import { prisma } from "../../../src/lib/prisma.js";
import { app } from "../../../src/app.js";
import {
  DAY_IN_MS,
  TEST_PASSWORD,
  createCustomer,
  createEvent,
  createOrganizer,
  signAccessToken,
} from "../../helpers/factories.js";

const REGISTER_SUCCESS_MESSAGE = "Register success";
const EMAIL_ALREADY_EXISTS_MESSAGE = "Email already exists";
const INVALID_REFERRAL_CODE_MESSAGE = "Invalid referral code";
const BALANCE_RETRIEVED_MESSAGE = "Point balance retrieved successfully";
const REFERRAL_POINTS = 10_000;
const REFERRAL_COUPON_VALUE = 10_000;
const REWARD_VALID_MONTHS = 3;

let sequence = 0;

type RegisterPayloadOverrides = {
  name?: string;
  email?: string;
  role?: Role;
  referralCode?: string;
  organizationName?: string;
};

function buildRegisterPayload(overrides: RegisterPayloadOverrides = {}) {
  sequence += 1;

  return {
    name: overrides.name ?? "Referred Customer",
    email: overrides.email ?? `referral-${Date.now()}-${sequence}@mail.com`,
    password: TEST_PASSWORD,
    ...(overrides.role !== undefined && { role: overrides.role }),
    ...(overrides.referralCode !== undefined && {
      referralCode: overrides.referralCode,
    }),
    ...(overrides.organizationName !== undefined && {
      organizationName: overrides.organizationName,
    }),
  };
}

function register(payload: ReturnType<typeof buildRegisterPayload>) {
  return request(app).post("/api/auth/register").send(payload);
}

async function getReferredUser(email: string) {
  return prisma.user.findUniqueOrThrow({ where: { email } });
}

async function getPointBalance(token: string) {
  return request(app)
    .get("/api/transactions/my/points")
    .set("Authorization", `Bearer ${token}`);
}

async function expectBalance(token: string, balance: number) {
  const response = await getPointBalance(token);

  expect(response.status).toBe(200);
  expect(response.body).toEqual({
    message: BALANCE_RETRIEVED_MESSAGE,
    data: { balance },
  });
}

function addMonths(date: Date, months: number) {
  const result = new Date(date);
  result.setMonth(result.getMonth() + months);
  return result;
}

const invalidReferralCodeTransforms: Array<[string, (code: string) => string]> = [
  ["lowercase", (code) => code.toLowerCase()],
  ["whitespace-padded", (code) => ` ${code} `],
];

const missingReferralCodeCases: Array<[string, string | undefined]> = [
  ["no referral code", undefined],
  ["an empty referral code", ""],
];

describe("POST /auth/register with a referral code", () => {
  it("should credit the referrer with 10,000 points and give the referred customer a REF coupon", async () => {
    // Arrange
    const referrer = await createCustomer({ name: "Budi Santoso" });
    const payload = buildRegisterPayload({
      name: "Sari Referral",
      referralCode: referrer.referralCode,
    });
    const registeredAt = new Date();

    // Act
    const response = await register(payload);

    // Assert
    expect(response.status).toBe(201);
    expect(response.body).toEqual({ message: REGISTER_SUCCESS_MESSAGE });

    const referredUser = await getReferredUser(payload.email);
    expect(referredUser.referredById).toBe(referrer.id);
    expect(referredUser.role).toBe(Role.CUSTOMER);
    expect(referredUser.referralCode).toBeTruthy();
    expect(referredUser.referralCode).not.toBe(referrer.referralCode);

    const points = await prisma.point.findMany({
      where: { userId: referrer.id },
    });
    expect(points).toHaveLength(1);
    expect(points[0].amount).toBe(REFERRAL_POINTS);

    const coupons = await prisma.coupon.findMany({
      where: { userId: referredUser.id },
    });
    expect(coupons).toHaveLength(1);
    expect(coupons[0].code).toMatch(/^REF-/);
    expect(coupons[0].discountValue).toBe(REFERRAL_COUPON_VALUE);
    expect(coupons[0].isUsed).toBe(false);

    // Both rewards share the same three-month expiry.
    expect(coupons[0].expiresAt.getTime()).toBe(points[0].expiresAt.getTime());
    const expectedExpiry = addMonths(registeredAt, REWARD_VALID_MONTHS);
    expect(points[0].expiresAt.getTime()).toBeGreaterThanOrEqual(
      expectedExpiry.getTime(),
    );
    expect(points[0].expiresAt.getTime()).toBeLessThanOrEqual(
      expectedExpiry.getTime() + 60_000,
    );

    // Only the referrer receives points and only the new user receives a coupon.
    expect(await prisma.point.count({ where: { userId: referredUser.id } })).toBe(
      0,
    );
    expect(await prisma.coupon.count({ where: { userId: referrer.id } })).toBe(0);
  });

  it("should make the referral points visible through the balance endpoint", async () => {
    // Arrange
    const referrer = await createCustomer();
    const payload = buildRegisterPayload({
      referralCode: referrer.referralCode,
    });

    // Act
    const response = await register(payload);

    // Assert
    expect(response.status).toBe(201);

    const referredUser = await getReferredUser(payload.email);
    await expectBalance(signAccessToken(referrer), REFERRAL_POINTS);
    await expectBalance(signAccessToken(referredUser), 0);
  });

  it("should credit the referrer once for every customer they refer", async () => {
    // Arrange
    const referrer = await createCustomer();
    const firstPayload = buildRegisterPayload({
      name: "First Referral",
      referralCode: referrer.referralCode,
    });
    const secondPayload = buildRegisterPayload({
      name: "Second Referral",
      referralCode: referrer.referralCode,
    });

    // Act
    const firstResponse = await register(firstPayload);
    const secondResponse = await register(secondPayload);

    // Assert
    expect(firstResponse.status).toBe(201);
    expect(secondResponse.status).toBe(201);

    const firstUser = await getReferredUser(firstPayload.email);
    const secondUser = await getReferredUser(secondPayload.email);
    expect(firstUser.referredById).toBe(referrer.id);
    expect(secondUser.referredById).toBe(referrer.id);

    const points = await prisma.point.findMany({
      where: { userId: referrer.id },
      orderBy: { id: "asc" },
    });
    expect(points).toHaveLength(2);
    expect(points.map((point) => point.amount)).toEqual([
      REFERRAL_POINTS,
      REFERRAL_POINTS,
    ]);

    expect(
      await prisma.coupon.count({ where: { userId: firstUser.id } }),
    ).toBe(1);
    expect(
      await prisma.coupon.count({ where: { userId: secondUser.id } }),
    ).toBe(1);

    await expectBalance(signAccessToken(referrer), 2 * REFERRAL_POINTS);
  });

  it("should not credit the referrer twice when the referred email is already registered", async () => {
    // Arrange
    const referrer = await createCustomer();
    const payload = buildRegisterPayload({
      referralCode: referrer.referralCode,
    });

    // Act
    const firstResponse = await register(payload);
    const secondResponse = await register(payload);

    // Assert
    expect(firstResponse.status).toBe(201);
    expect(secondResponse.status).toBe(400);
    expect(secondResponse.body).toEqual({
      message: EMAIL_ALREADY_EXISTS_MESSAGE,
    });

    expect(await prisma.user.count({ where: { email: payload.email } })).toBe(
      1,
    );
    expect(await prisma.point.count({ where: { userId: referrer.id } })).toBe(1);

    await expectBalance(signAccessToken(referrer), REFERRAL_POINTS);
  });

  it("should return 400 and create nothing for an unknown referral code", async () => {
    // Arrange
    const payload = buildRegisterPayload({
      referralCode: `UNKNOWN-${Date.now()}`,
    });

    // Act
    const response = await register(payload);

    // Assert
    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      message: INVALID_REFERRAL_CODE_MESSAGE,
    });

    expect(
      await prisma.user.findUnique({ where: { email: payload.email } }),
    ).toBeNull();
    expect(await prisma.user.count()).toBe(0);
    expect(await prisma.point.count()).toBe(0);
    expect(await prisma.coupon.count()).toBe(0);
  });

  it.each(invalidReferralCodeTransforms)(
    "should return 400 for a %s referral code",
    async (_label, transform) => {
      // Arrange
      const referrer = await createCustomer();
      const payload = buildRegisterPayload({
        referralCode: transform(referrer.referralCode),
      });

      // Act
      const response = await register(payload);

      // Assert
      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        message: INVALID_REFERRAL_CODE_MESSAGE,
      });
      expect(
        await prisma.user.findUnique({ where: { email: payload.email } }),
      ).toBeNull();
      expect(await prisma.point.count()).toBe(0);
    },
  );

  it.each(missingReferralCodeCases)(
    "should register without a referral reward when given %s",
    async (_label, referralCode) => {
      // Arrange
      const payload = buildRegisterPayload();
      const requestPayload =
        referralCode === undefined ? payload : { ...payload, referralCode };

      // Act
      const response = await register(requestPayload);

      // Assert
      expect(response.status).toBe(201);
      expect(response.body).toEqual({ message: REGISTER_SUCCESS_MESSAGE });

      const user = await getReferredUser(payload.email);
      expect(user.referredById).toBeNull();
      expect(await prisma.point.count({ where: { userId: user.id } })).toBe(0);
      expect(await prisma.coupon.count({ where: { userId: user.id } })).toBe(0);
    },
  );

  it("should still reward the referrer when the referred user registers as an organizer", async () => {
    // Arrange
    const referrer = await createCustomer();
    const payload = buildRegisterPayload({
      name: "Referred Organizer",
      role: Role.ORGANIZER,
      organizationName: "Referred Events",
      referralCode: referrer.referralCode,
    });

    // Act
    const response = await register(payload);

    // Assert
    expect(response.status).toBe(201);

    const referredUser = await getReferredUser(payload.email);
    expect(referredUser.referredById).toBe(referrer.id);
    expect(referredUser.role).toBe(Role.ORGANIZER);

    const organization = await prisma.organization.findUniqueOrThrow({
      where: { userId: referredUser.id },
    });
    expect(organization.name).toBe("Referred Events");

    expect(await prisma.point.count({ where: { userId: referrer.id } })).toBe(1);
    expect(
      await prisma.coupon.count({ where: { userId: referredUser.id } }),
    ).toBe(1);

    await expectBalance(signAccessToken(referrer), REFERRAL_POINTS);
  });

  it("should credit an organizer referrer even though organizers cannot view the point balance", async () => {
    // Arrange
    const { user: organizer } = await createOrganizer();
    const payload = buildRegisterPayload({
      referralCode: organizer.referralCode,
    });

    // Act
    const response = await register(payload);

    // Assert
    expect(response.status).toBe(201);

    const point = await prisma.point.findFirstOrThrow({
      where: { userId: organizer.id },
    });
    expect(point.amount).toBe(REFERRAL_POINTS);

    const balanceResponse = await getPointBalance(signAccessToken(organizer));
    expect(balanceResponse.status).toBe(403);
    expect(balanceResponse.body).toEqual({ message: "Forbidden" });
  });
});

describe("referral rewards lifecycle", () => {
  it("should let a referred customer refer someone else and earn their own points", async () => {
    // Arrange
    const first = await createCustomer({ name: "First Referrer" });
    const secondPayload = buildRegisterPayload({
      name: "Second Referrer",
      referralCode: first.referralCode,
    });

    const secondResponse = await register(secondPayload);
    expect(secondResponse.status).toBe(201);
    const second = await getReferredUser(secondPayload.email);

    // Act
    const thirdPayload = buildRegisterPayload({
      name: "Third Customer",
      referralCode: second.referralCode,
    });
    const thirdResponse = await register(thirdPayload);

    // Assert
    expect(thirdResponse.status).toBe(201);
    const third = await getReferredUser(thirdPayload.email);

    await expectBalance(signAccessToken(first), REFERRAL_POINTS);
    await expectBalance(signAccessToken(second), REFERRAL_POINTS);
    await expectBalance(signAccessToken(third), 0);

    // The second customer received the reward coupon as a referred user and
    // the reward points as a referrer.
    expect(await prisma.coupon.count({ where: { userId: second.id } })).toBe(1);
    expect(await prisma.point.count({ where: { userId: second.id } })).toBe(1);
    expect(await prisma.coupon.count({ where: { userId: third.id } })).toBe(1);

    const secondPoint = await prisma.point.findFirstOrThrow({
      where: { userId: second.id },
    });
    expect(secondPoint.expiresAt.getTime()).toBeGreaterThan(
      Date.now() + 80 * DAY_IN_MS,
    );
  });

  it("should let the referred customer redeem the REF coupon at checkout", async () => {
    // Arrange
    const referrer = await createCustomer();
    const referredPayload = buildRegisterPayload({
      referralCode: referrer.referralCode,
    });
    await register(referredPayload);

    const referredUser = await getReferredUser(referredPayload.email);
    const coupon = await prisma.coupon.findFirstOrThrow({
      where: { userId: referredUser.id },
    });

    const { organization } = await createOrganizer();
    const { ticket } = await createEvent(organization.id, {
      tickets: [{ price: 50_000, quantity: 10 }],
    });

    // Act
    const response = await request(app)
      .post("/api/transactions")
      .set("Authorization", `Bearer ${signAccessToken(referredUser)}`)
      .send({
        ticketId: ticket.id,
        quantity: 1,
        couponCode: coupon.code,
      });

    // Assert
    expect(response.status).toBe(201);
    expect(response.body.data).toMatchObject({
      couponId: coupon.id,
      total: 50_000,
      discount: REFERRAL_COUPON_VALUE,
      finalPrice: 40_000,
      pointsUsed: 0,
    });

    const savedCoupon = await prisma.coupon.findUniqueOrThrow({
      where: { id: coupon.id },
    });
    expect(savedCoupon.isUsed).toBe(true);

    // Redeeming the coupon must not touch the referrer's points.
    await expectBalance(signAccessToken(referrer), REFERRAL_POINTS);
  });
});
