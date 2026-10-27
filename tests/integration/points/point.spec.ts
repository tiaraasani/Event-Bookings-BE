import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { PaymentStatus } from "../../../src/generated/prisma/enums.js";

vi.mock("../../../src/lib/mail.js", () => ({
  sendMail: vi.fn(),
}));

import { prisma } from "../../../src/lib/prisma.js";
import { app } from "../../../src/app.js";
import {
  DAY_IN_MS,
  HOUR_IN_MS,
  TEST_PASSWORD,
  createCustomer,
  createEvent,
  createOrganizer,
  createPoint,
  signAccessToken,
  signExpiredToken,
} from "../../helpers/factories.js";

const BALANCE_RETRIEVED_MESSAGE = "Point balance retrieved successfully";
const TRANSACTION_CREATED_MESSAGE = "Transaction created successfully";
const TRANSACTION_REJECTED_MESSAGE = "Transaction rejected";
const INSUFFICIENT_POINTS_MESSAGE = "Insufficient points balance";
const REFERRAL_POINTS = 10_000;

function getPointBalance(token?: string) {
  const req = request(app).get("/api/transactions/my/points");

  if (token !== undefined) {
    req.set("Authorization", `Bearer ${token}`);
  }

  return req;
}

function postTransaction(
  token: string | undefined,
  payload: {
    ticketId: number;
    quantity?: number;
    pointsToUse?: number;
  },
) {
  const req = request(app).post("/api/transactions");

  if (token !== undefined) {
    req.set("Authorization", `Bearer ${token}`);
  }

  return req.send({ quantity: 1, ...payload });
}

function rejectTransaction(orderId: number, token: string) {
  return request(app)
    .patch(`/api/organizer/transactions/${orderId}/reject`)
    .set("Authorization", `Bearer ${token}`);
}

function registerCustomer(payload: {
  name: string;
  email: string;
  password: string;
  referralCode?: string;
}) {
  return request(app).post("/api/auth/register").send(payload);
}

async function expectBalance(token: string, balance: number) {
  const response = await getPointBalance(token);

  expect(response.status).toBe(200);
  expect(response.body).toEqual({
    message: BALANCE_RETRIEVED_MESSAGE,
    data: { balance },
  });
}

describe("GET /transactions/my/points", () => {
  it("should return the sum of the customer's usable points", async () => {
    // Arrange
    const customer = await createCustomer();
    const otherCustomer = await createCustomer();

    await createPoint(customer.id, {
      amount: 40,
      expiresAt: new Date(Date.now() + 2 * DAY_IN_MS),
    });
    await createPoint(customer.id, {
      amount: 60,
      expiresAt: new Date(Date.now() + 5 * DAY_IN_MS),
    });
    await createPoint(customer.id, { amount: 15_000 });
    await createPoint(otherCustomer.id, { amount: 500_000 });

    // Act
    const response = await getPointBalance(signAccessToken(customer));

    // Assert
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      message: BALANCE_RETRIEVED_MESSAGE,
      data: { balance: 15_100 },
    });
  });

  it("should return a zero balance when the customer has no point records", async () => {
    // Arrange
    const customer = await createCustomer();

    // Act
    const response = await getPointBalance(signAccessToken(customer));

    // Assert
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      message: BALANCE_RETRIEVED_MESSAGE,
      data: { balance: 0 },
    });
  });

  it("should ignore expired points even when they still have a balance", async () => {
    // Arrange
    const customer = await createCustomer();
    await createPoint(customer.id, {
      amount: 100_000,
      expiresAt: new Date(Date.now() - DAY_IN_MS),
    });
    await createPoint(customer.id, {
      amount: 2_500,
      expiresAt: new Date(Date.now() + HOUR_IN_MS),
    });

    // Act
    const response = await getPointBalance(signAccessToken(customer));

    // Assert
    expect(response.status).toBe(200);
    expect(response.body.data.balance).toBe(2_500);
  });

  it("should ignore point records whose remaining amount is zero", async () => {
    // Arrange
    const customer = await createCustomer();
    await createPoint(customer.id, { amount: 0 });
    await createPoint(customer.id, { amount: 0 });
    await createPoint(customer.id, { amount: 7_500 });

    // Act
    const response = await getPointBalance(signAccessToken(customer));

    // Assert
    expect(response.status).toBe(200);
    expect(response.body.data.balance).toBe(7_500);
  });

  it("should count a partially used point at its remaining amount", async () => {
    // Arrange
    const customer = await createCustomer();
    const point = await createPoint(customer.id, { amount: 10_000 });

    await prisma.point.update({
      where: { id: point.id },
      data: { amount: 3_000 },
    });

    // Act
    const response = await getPointBalance(signAccessToken(customer));

    // Assert
    expect(response.status).toBe(200);
    expect(response.body.data.balance).toBe(3_000);
  });

  it("should work with a token obtained from the login endpoint", async () => {
    // Arrange
    const customer = await createCustomer();
    await createPoint(customer.id, { amount: 12_345 });

    const loginResponse = await request(app).post("/api/auth/login").send({
      email: customer.email,
      password: TEST_PASSWORD,
    });

    // Act
    const response = await getPointBalance(loginResponse.body.accessToken);

    // Assert
    expect(loginResponse.status).toBe(200);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      message: BALANCE_RETRIEVED_MESSAGE,
      data: { balance: 12_345 },
    });
  });

  it("should return 401 when no token is provided", async () => {
    // Act
    const response = await getPointBalance();

    // Assert
    expect(response.status).toBe(401);
    expect(response.body).toEqual({ message: "Token not provided" });
  });

  it("should return 401 when the authorization header lacks the Bearer scheme", async () => {
    // Arrange
    const customer = await createCustomer();

    // Act
    const response = await request(app)
      .get("/api/transactions/my/points")
      .set("Authorization", signAccessToken(customer));

    // Assert
    expect(response.status).toBe(401);
    expect(response.body).toEqual({ message: "Token not provided" });
  });

  it("should return 401 for an invalid token", async () => {
    // Act
    const response = await getPointBalance("not-a-real-token");

    // Assert
    expect(response.status).toBe(401);
    expect(response.body).toEqual({ message: "Invalid token" });
  });

  it("should return 401 for an expired token", async () => {
    // Arrange
    const customer = await createCustomer();
    await createPoint(customer.id, { amount: 10_000 });

    // Act
    const response = await getPointBalance(signExpiredToken(customer));

    // Assert
    expect(response.status).toBe(401);
    expect(response.body).toEqual({ message: "Token expired" });
  });

  it("should return 403 when the authenticated user is not a customer", async () => {
    // Arrange
    const { user } = await createOrganizer();

    // Act
    const response = await getPointBalance(signAccessToken(user));

    // Assert
    expect(response.status).toBe(403);
    expect(response.body).toEqual({ message: "Forbidden" });
  });
});

describe("point balance lifecycle", () => {
  it("should credit the referrer with 10,000 points when a new customer registers with their referral code", async () => {
    // Arrange
    const referrer = await createCustomer({ name: "Budi Santoso" });
    const email = `referred-${Date.now()}@mail.com`;

    // Act
    const registerResponse = await registerCustomer({
      name: "Sari Referral",
      email,
      password: TEST_PASSWORD,
      referralCode: referrer.referralCode,
    });

    // Assert
    expect(registerResponse.status).toBe(201);
    expect(registerResponse.body).toEqual({ message: "Register success" });

    const referredUser = await prisma.user.findUniqueOrThrow({
      where: { email },
    });
    expect(referredUser.referredById).toBe(referrer.id);

    const referrerPoint = await prisma.point.findFirstOrThrow({
      where: { userId: referrer.id },
    });
    expect(referrerPoint.amount).toBe(REFERRAL_POINTS);
    expect(referrerPoint.expiresAt.getTime()).toBeGreaterThan(
      Date.now() + 80 * DAY_IN_MS,
    );
    expect(referrerPoint.expiresAt.getTime()).toBeLessThan(
      Date.now() + 100 * DAY_IN_MS,
    );

    await expectBalance(signAccessToken(referrer), REFERRAL_POINTS);
    await expectBalance(signAccessToken(referredUser), 0);
  });

  it("should lower the balance by the points redeemed at checkout", async () => {
    // Arrange
    const customer = await createCustomer();
    const { organization } = await createOrganizer();
    const { ticket } = await createEvent(organization.id, {
      tickets: [{ price: 100_000, quantity: 100 }],
    });
    const point = await createPoint(customer.id, { amount: 20_000 });

    // Act
    const response = await postTransaction(signAccessToken(customer), {
      ticketId: ticket.id,
      pointsToUse: 8_000,
    });

    // Assert
    expect(response.status).toBe(201);
    expect(response.body.message).toBe(TRANSACTION_CREATED_MESSAGE);
    expect(response.body.data).toMatchObject({
      pointsUsed: 8_000,
      discount: 8_000,
      finalPrice: 92_000,
    });
    expect(response.body.data.pointUsages).toEqual([
      expect.objectContaining({
        orderId: response.body.data.id,
        pointId: point.id,
        amount: 8_000,
      }),
    ]);

    const savedPoint = await prisma.point.findUniqueOrThrow({
      where: { id: point.id },
    });
    expect(savedPoint.amount).toBe(12_000);

    await expectBalance(signAccessToken(customer), 12_000);
  });

  it("should report a zero balance after the customer spends every point", async () => {
    // Arrange
    const customer = await createCustomer();
    const { organization } = await createOrganizer();
    const { ticket } = await createEvent(organization.id, {
      tickets: [{ price: 100_000, quantity: 100 }],
    });
    const point = await createPoint(customer.id, { amount: 5_000 });

    // Act
    const response = await postTransaction(signAccessToken(customer), {
      ticketId: ticket.id,
      pointsToUse: 5_000,
    });

    // Assert
    expect(response.status).toBe(201);
    expect(response.body.data).toMatchObject({
      pointsUsed: 5_000,
      discount: 5_000,
      finalPrice: 95_000,
    });

    const savedPoint = await prisma.point.findUniqueOrThrow({
      where: { id: point.id },
    });
    expect(savedPoint.amount).toBe(0);

    await expectBalance(signAccessToken(customer), 0);
  });

  it("should leave the balance untouched when checkout fails for insufficient points", async () => {
    // Arrange
    const customer = await createCustomer();
    const { organization } = await createOrganizer();
    const { ticket } = await createEvent(organization.id, {
      tickets: [{ price: 100_000, quantity: 100 }],
    });
    const point = await createPoint(customer.id, { amount: 5_000 });

    // Act
    const response = await postTransaction(signAccessToken(customer), {
      ticketId: ticket.id,
      pointsToUse: 5_001,
    });

    // Assert
    expect(response.status).toBe(400);
    expect(response.body).toEqual({ message: INSUFFICIENT_POINTS_MESSAGE });

    const savedPoint = await prisma.point.findUniqueOrThrow({
      where: { id: point.id },
    });
    expect(savedPoint.amount).toBe(5_000);
    expect(await prisma.order.count()).toBe(0);
    expect(await prisma.pointUsage.count()).toBe(0);

    await expectBalance(signAccessToken(customer), 5_000);
  });

  it("should keep each customer's balance separate when only one of them spends points", async () => {
    // Arrange
    const spendingCustomer = await createCustomer();
    const otherCustomer = await createCustomer();
    const { organization } = await createOrganizer();
    const { ticket } = await createEvent(organization.id, {
      tickets: [{ price: 100_000, quantity: 100 }],
    });
    await createPoint(spendingCustomer.id, { amount: 10_000 });
    await createPoint(otherCustomer.id, { amount: 10_000 });

    // Act
    const response = await postTransaction(signAccessToken(spendingCustomer), {
      ticketId: ticket.id,
      pointsToUse: 4_000,
    });

    // Assert
    expect(response.status).toBe(201);

    await expectBalance(signAccessToken(spendingCustomer), 6_000);
    await expectBalance(signAccessToken(otherCustomer), 10_000);
  });

  it("should restore the redeemed points when the organizer rejects the payment", async () => {
    // Arrange
    const customer = await createCustomer();
    const { user: organizer, organization } = await createOrganizer();
    const { ticket } = await createEvent(organization.id, {
      tickets: [{ price: 100_000, quantity: 100 }],
    });
    const point = await createPoint(customer.id, { amount: 30_000 });

    const checkoutResponse = await postTransaction(signAccessToken(customer), {
      ticketId: ticket.id,
      pointsToUse: 12_000,
    });
    expect(checkoutResponse.status).toBe(201);
    const orderId = checkoutResponse.body.data.id;

    await prisma.order.update({
      where: { id: orderId },
      data: {
        paymentStatus: PaymentStatus.WAITING_FOR_CONFIRMATION,
        paymentProofUrl: "https://res.cloudinary.com/demo/proof.png",
      },
    });
    await expectBalance(signAccessToken(customer), 18_000);

    // Act
    const response = await rejectTransaction(
      orderId,
      signAccessToken(organizer),
    );

    // Assert
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ message: TRANSACTION_REJECTED_MESSAGE });

    const savedPoint = await prisma.point.findUniqueOrThrow({
      where: { id: point.id },
    });
    expect(savedPoint.amount).toBe(30_000);
    expect(await prisma.pointUsage.count({ where: { orderId } })).toBe(0);

    await expectBalance(signAccessToken(customer), 30_000);
  });
});
