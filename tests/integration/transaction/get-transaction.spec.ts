import argon from "argon2";
import jwt from "jsonwebtoken";
import request from "supertest";
import { describe, expect, it } from "vitest";
import {
  EventType,
  PaymentStatus,
  Role,
} from "../../../src/generated/prisma/enums.js";
import { prisma } from "../../../src/lib/prisma.js";
import { app } from "../../../src/app.js";

const DAY_IN_MS = 24 * 60 * 60 * 1000;
const HOUR_IN_MS = 60 * 60 * 1000;

type TestUserOverrides = {
  name?: string;
  email?: string;
  role?: Role;
};

type TestOrganizerOverrides = {
  name?: string;
  email?: string;
  organizationName?: string;
  organizationLogo?: string | null;
};

type TestTicketOverrides = {
  name?: string;
  price?: number;
  quantity?: number;
  availableQuantity?: number;
};

type TestEventOverrides = {
  name?: string;
  description?: string | null;
  city?: string;
  categoryName?: string;
  startDate?: Date;
  endDate?: Date;
  tickets?: TestTicketOverrides[];
};

type TestVoucherOverrides = {
  code?: string;
  discountValue?: number;
  quota?: number;
  startDate?: Date;
  endDate?: Date;
};

type TestCouponOverrides = {
  code?: string;
  discountValue?: number;
  isUsed?: boolean;
  expiresAt?: Date;
};

type TestOrderOverrides = {
  quantity?: number;
  total?: number;
  pointsUsed?: number;
  discount?: number;
  finalPrice?: number;
  voucherId?: number | null;
  couponId?: number | null;
  paymentStatus?: PaymentStatus;
  paymentProofUrl?: string | null;
  paidAt?: Date | null;
  expiresAt?: Date | null;
  createdAt?: Date;
};

type TestPointOverrides = {
  amount?: number;
  expiresAt?: Date;
};

let sequence = 0;
let passwordHashPromise: Promise<string> | undefined;

function getPasswordHash() {
  passwordHashPromise ??= argon.hash("Test123!");
  return passwordHashPromise;
}

async function createUser(overrides: TestUserOverrides = {}) {
  sequence += 1;

  return prisma.user.create({
    data: {
      name: overrides.name ?? "Test User",
      email: overrides.email ?? `user-${Date.now()}-${sequence}@mail.com`,
      password: await getPasswordHash(),
      role: overrides.role ?? Role.CUSTOMER,
      referralCode: `USER${Date.now()}${sequence}`,
    },
  });
}

async function createCustomer(overrides: TestUserOverrides = {}) {
  return createUser({ ...overrides, role: Role.CUSTOMER });
}

async function createOrganizer(overrides: TestOrganizerOverrides = {}) {
  const user = await createUser({
    name: overrides.name ?? "Event Organizer",
    email: overrides.email ?? `organizer-${Date.now()}-${sequence}@mail.com`,
    role: Role.ORGANIZER,
  });

  const organization = await prisma.organization.create({
    data: {
      userId: user.id,
      name: overrides.organizationName ?? "Acme Events",
      logo: overrides.organizationLogo ?? null,
    },
  });

  return { user, organization };
}

async function createEvent(
  organizationId: number,
  overrides: TestEventOverrides = {},
) {
  sequence += 1;

  const category = await prisma.category.create({
    data: {
      name: overrides.categoryName ?? `Category ${Date.now()}-${sequence}`,
    },
  });

  const startDate = overrides.startDate ?? new Date(Date.now() + 7 * DAY_IN_MS);
  const endDate =
    overrides.endDate ?? new Date(startDate.getTime() + DAY_IN_MS);
  const tickets = overrides.tickets ?? [{}];

  const event = await prisma.event.create({
    data: {
      categoryId: category.id,
      organizationId,
      name: overrides.name ?? "Jakarta Music Fest",
      description:
        overrides.description === undefined
          ? "A full-day music festival"
          : overrides.description,
      city: overrides.city ?? "Jakarta",
      type: EventType.VENUE,
      slug: `event-${Date.now()}-${sequence}`,
      startDate,
      endDate,
      tickets: {
        create: tickets.map((ticket) => ({
          name: ticket.name ?? "General Admission",
          price: ticket.price ?? 100_000,
          quantity: ticket.quantity ?? 100,
          availableQuantity: ticket.availableQuantity ?? ticket.quantity ?? 100,
        })),
      },
    },
    include: { category: true, tickets: true },
  });

  return { event, category, ticket: event.tickets[0] };
}

async function createVoucher(
  eventId: number,
  overrides: TestVoucherOverrides = {},
) {
  sequence += 1;

  return prisma.voucher.create({
    data: {
      eventId,
      code: overrides.code ?? `VOUCHER${Date.now()}${sequence}`,
      discountValue: overrides.discountValue ?? 10,
      quota: overrides.quota ?? 10,
      startDate: overrides.startDate ?? new Date(Date.now() - DAY_IN_MS),
      endDate: overrides.endDate ?? new Date(Date.now() + 7 * DAY_IN_MS),
    },
  });
}

async function createCoupon(
  userId: number,
  overrides: TestCouponOverrides = {},
) {
  sequence += 1;

  return prisma.coupon.create({
    data: {
      userId,
      code: overrides.code ?? `COUPON${Date.now()}${sequence}`,
      discountValue: overrides.discountValue ?? 10_000,
      isUsed: overrides.isUsed ?? false,
      expiresAt: overrides.expiresAt ?? new Date(Date.now() + 7 * DAY_IN_MS),
    },
  });
}

async function createOrder(
  userId: number,
  ticketId: number,
  overrides: TestOrderOverrides = {},
) {
  const quantity = overrides.quantity ?? 1;
  const total = overrides.total ?? 100_000;
  const discount = overrides.discount ?? 0;
  const pointsUsed = overrides.pointsUsed ?? 0;

  return prisma.order.create({
    data: {
      userId,
      ticketId,
      quantity,
      total,
      discount,
      pointsUsed,
      finalPrice: overrides.finalPrice ?? total - discount - pointsUsed,
      voucherId: overrides.voucherId ?? null,
      couponId: overrides.couponId ?? null,
      paymentStatus:
        overrides.paymentStatus ?? PaymentStatus.WAITING_FOR_PAYMENT,
      paymentProofUrl: overrides.paymentProofUrl ?? null,
      paidAt: overrides.paidAt ?? null,
      expiresAt: overrides.expiresAt ?? new Date(Date.now() + 2 * HOUR_IN_MS),
      ...(overrides.createdAt !== undefined && {
        createdAt: overrides.createdAt,
      }),
    },
  });
}

async function createPoint(
  userId: number,
  overrides: TestPointOverrides = {},
) {
  return prisma.point.create({
    data: {
      userId,
      amount: overrides.amount ?? 100_000,
      expiresAt: overrides.expiresAt ?? new Date(Date.now() + 7 * DAY_IN_MS),
    },
  });
}

function signAccessToken(
  user: { id: number; role: Role },
  options: jwt.SignOptions = {},
) {
  return jwt.sign({ id: user.id, role: user.role }, process.env.JWT_SECRET!, {
    expiresIn: "1h",
    ...options,
  });
}

function getMyTransactions(token?: string) {
  const req = request(app).get("/api/transactions/my");

  if (token !== undefined) {
    req.set("Authorization", `Bearer ${token}`);
  }

  return req;
}

function getMyPointBalance(token?: string) {
  const req = request(app).get("/api/transactions/my/points");

  if (token !== undefined) {
    req.set("Authorization", `Bearer ${token}`);
  }

  return req;
}

describe("GET /transactions/my", () => {
  it("should return the customer's transactions with their ticket, event, voucher and coupon details", async () => {
    // Arrange
    const customer = await createCustomer({ name: "Budi Santoso" });
    const { user: organizerUser, organization } = await createOrganizer({
      name: "Siti Organizer",
      organizationName: "Acme Events",
      organizationLogo: "https://res.cloudinary.com/demo/image/upload/logo.png",
    });
    const { event, category, ticket } = await createEvent(organization.id, {
      name: "Jakarta Music Fest",
      description: "A full-day music festival",
      city: "Jakarta",
      categoryName: "Music",
      tickets: [
        {
          name: "VIP",
          price: 100_000,
          quantity: 100,
          availableQuantity: 90,
        },
      ],
    });
    const voucher = await createVoucher(event.id, {
      code: "SAVE10",
      discountValue: 10,
      quota: 10,
    });
    const paidAt = new Date("2026-10-20T08:30:00.000Z");

    const order = await createOrder(customer.id, ticket.id, {
      quantity: 2,
      total: 200_000,
      discount: 20_000,
      finalPrice: 180_000,
      voucherId: voucher.id,
      paymentStatus: PaymentStatus.PAID,
      paymentProofUrl:
        "https://res.cloudinary.com/demo/image/upload/payment-proof.jpg",
      paidAt,
    });

    // Act
    const response = await getMyTransactions(signAccessToken(customer));

    // Assert
    expect(response.status).toBe(200);
    expect(response.body.message).toBe("Transactions retrieved successfully");
    expect(response.body.data).toHaveLength(1);

    const [returnedOrder] = response.body.data;
    expect(returnedOrder).toMatchObject({
      id: order.id,
      userId: customer.id,
      ticketId: ticket.id,
      quantity: 2,
      total: 200_000,
      pointsUsed: 0,
      discount: 20_000,
      finalPrice: 180_000,
      voucherId: voucher.id,
      couponId: null,
      paymentStatus: PaymentStatus.PAID,
      paymentProofUrl:
        "https://res.cloudinary.com/demo/image/upload/payment-proof.jpg",
      paidAt: paidAt.toISOString(),
      expiresAt: order.expiresAt!.toISOString(),
      createdAt: order.createdAt.toISOString(),
      updatedAt: order.updatedAt.toISOString(),
    });

    expect(returnedOrder.ticket).toMatchObject({
      id: ticket.id,
      eventId: event.id,
      name: "VIP",
      price: 100_000,
      quantity: 100,
      availableQuantity: 90,
    });

    expect(returnedOrder.ticket.event).toMatchObject({
      id: event.id,
      categoryId: category.id,
      organizationId: organization.id,
      name: "Jakarta Music Fest",
      description: "A full-day music festival",
      city: "Jakarta",
      type: EventType.VENUE,
      slug: event.slug,
      image: null,
      startDate: event.startDate.toISOString(),
      endDate: event.endDate.toISOString(),
      deletedAt: null,
    });

    expect(returnedOrder.ticket.event.category).toEqual({
      id: category.id,
      name: "Music",
      description: null,
    });

    expect(returnedOrder.ticket.event.organization).toEqual({
      id: organization.id,
      userId: organizerUser.id,
      name: "Acme Events",
      logo: "https://res.cloudinary.com/demo/image/upload/logo.png",
      description: null,
      field: null,
    });

    expect(returnedOrder.voucher).toEqual({
      id: voucher.id,
      eventId: event.id,
      code: "SAVE10",
      discountValue: 10,
      quota: 10,
      startDate: voucher.startDate.toISOString(),
      endDate: voucher.endDate.toISOString(),
      createdAt: voucher.createdAt.toISOString(),
    });
    expect(returnedOrder.coupon).toBeNull();
    expect(JSON.stringify(response.body)).not.toContain("password");
  });

  it("should only return transactions that belong to the authenticated customer", async () => {
    // Arrange
    const customer = await createCustomer();
    const otherCustomer = await createCustomer();
    const { organization } = await createOrganizer();
    const { ticket } = await createEvent(organization.id);

    const waitingOrder = await createOrder(customer.id, ticket.id, {
      paymentStatus: PaymentStatus.WAITING_FOR_PAYMENT,
    });
    const paidOrder = await createOrder(customer.id, ticket.id, {
      quantity: 2,
      total: 200_000,
      finalPrice: 200_000,
      paymentStatus: PaymentStatus.PAID,
      paidAt: new Date(),
    });
    await createOrder(otherCustomer.id, ticket.id, {
      paymentStatus: PaymentStatus.WAITING_FOR_CONFIRMATION,
    });

    // Act
    const response = await getMyTransactions(signAccessToken(customer));

    // Assert
    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(2);
    expect(response.body.data.map((order: { id: number }) => order.id)).toEqual(
      expect.arrayContaining([waitingOrder.id, paidOrder.id]),
    );
    expect(
      response.body.data.every(
        (order: { userId: number }) => order.userId === customer.id,
      ),
    ).toBe(true);
  });

  it("should order transactions by creation date descending", async () => {
    // Arrange
    const customer = await createCustomer();
    const { organization } = await createOrganizer();
    const { ticket } = await createEvent(organization.id);

    const earliest = await createOrder(customer.id, ticket.id, {
      createdAt: new Date("2026-10-01T08:00:00.000Z"),
    });
    const middle = await createOrder(customer.id, ticket.id, {
      createdAt: new Date("2026-10-10T08:00:00.000Z"),
    });
    const latest = await createOrder(customer.id, ticket.id, {
      createdAt: new Date("2026-10-20T08:00:00.000Z"),
    });

    // Act
    const response = await getMyTransactions(signAccessToken(customer));

    // Assert
    expect(response.status).toBe(200);
    expect(
      response.body.data.map((order: { id: number }) => order.id),
    ).toEqual([latest.id, middle.id, earliest.id]);
  });

  it("should return the coupon attached to a transaction", async () => {
    // Arrange
    const customer = await createCustomer();
    const { organization } = await createOrganizer();
    const { ticket } = await createEvent(organization.id);
    const coupon = await createCoupon(customer.id, {
      code: "WELCOME25",
      discountValue: 25_000,
    });

    await createOrder(customer.id, ticket.id, {
      couponId: coupon.id,
      discount: 25_000,
      finalPrice: 75_000,
      paymentStatus: PaymentStatus.WAITING_FOR_PAYMENT,
    });

    // Act
    const response = await getMyTransactions(signAccessToken(customer));

    // Assert
    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(1);

    const [returnedOrder] = response.body.data;
    expect(returnedOrder.couponId).toBe(coupon.id);
    expect(returnedOrder.coupon).toEqual({
      id: coupon.id,
      userId: customer.id,
      code: "WELCOME25",
      discountValue: 25_000,
      isUsed: false,
      createdAt: coupon.createdAt.toISOString(),
      expiresAt: coupon.expiresAt.toISOString(),
    });
    expect(returnedOrder.voucher).toBeNull();
  });

  it("should return an empty list when the customer has no transactions", async () => {
    // Arrange
    const customer = await createCustomer();

    // Act
    const response = await getMyTransactions(signAccessToken(customer));

    // Assert
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      message: "Transactions retrieved successfully",
      data: [],
    });
  });

  it("should work with a token obtained from the login endpoint", async () => {
    // Arrange
    const customer = await createCustomer();
    const { organization } = await createOrganizer();
    const { ticket } = await createEvent(organization.id);
    const order = await createOrder(customer.id, ticket.id);

    const loginResponse = await request(app).post("/api/auth/login").send({
      email: customer.email,
      password: "Test123!",
    });

    // Act
    const response = await getMyTransactions(loginResponse.body.accessToken);

    // Assert
    expect(loginResponse.status).toBe(200);
    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0].id).toBe(order.id);
  });

  it("should return 401 when no token is provided", async () => {
    // Act
    const response = await getMyTransactions();

    // Assert
    expect(response.status).toBe(401);
    expect(response.body).toEqual({ message: "Token not provided" });
  });

  it("should return 401 when the authorization header lacks the Bearer scheme", async () => {
    // Arrange
    const customer = await createCustomer();

    // Act
    const response = await request(app)
      .get("/api/transactions/my")
      .set("Authorization", signAccessToken(customer));

    // Assert
    expect(response.status).toBe(401);
    expect(response.body).toEqual({ message: "Token not provided" });
  });

  it("should return 401 for an invalid token", async () => {
    // Act
    const response = await getMyTransactions("not-a-real-token");

    // Assert
    expect(response.status).toBe(401);
    expect(response.body).toEqual({ message: "Invalid token" });
  });

  it("should return 401 for an expired token", async () => {
    // Arrange
    const customer = await createCustomer();
    const token = signAccessToken(customer, { expiresIn: -10 });

    // Act
    const response = await getMyTransactions(token);

    // Assert
    expect(response.status).toBe(401);
    expect(response.body).toEqual({ message: "Token expired" });
  });

  it("should return 403 when the authenticated user is not a customer", async () => {
    // Arrange
    const { user } = await createOrganizer();

    // Act
    const response = await getMyTransactions(signAccessToken(user));

    // Assert
    expect(response.status).toBe(403);
    expect(response.body).toEqual({ message: "Forbidden" });
  });
});

describe("GET /transactions/my/points", () => {
  it("should return the total balance of usable points for the authenticated customer", async () => {
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
    await createPoint(customer.id, {
      amount: 100,
      expiresAt: new Date(Date.now() - DAY_IN_MS),
    });
    await createPoint(customer.id, { amount: 0 });
    await createPoint(otherCustomer.id, {
      amount: 500,
      expiresAt: new Date(Date.now() + 2 * DAY_IN_MS),
    });

    // Act
    const response = await getMyPointBalance(signAccessToken(customer));

    // Assert
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      message: "Point balance retrieved successfully",
      data: { balance: 100 },
    });
  });

  it("should return a zero balance when the customer has no usable points", async () => {
    // Arrange
    const customer = await createCustomer();
    await createPoint(customer.id, {
      amount: 50,
      expiresAt: new Date(Date.now() - DAY_IN_MS),
    });
    await createPoint(customer.id, { amount: 0 });

    // Act
    const response = await getMyPointBalance(signAccessToken(customer));

    // Assert
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      message: "Point balance retrieved successfully",
      data: { balance: 0 },
    });
  });

  it("should return 401 when no token is provided", async () => {
    // Act
    const response = await getMyPointBalance();

    // Assert
    expect(response.status).toBe(401);
    expect(response.body).toEqual({ message: "Token not provided" });
  });

  it("should return 401 for an invalid token", async () => {
    // Act
    const response = await getMyPointBalance("not-a-real-token");

    // Assert
    expect(response.status).toBe(401);
    expect(response.body).toEqual({ message: "Invalid token" });
  });

  it("should return 403 when the authenticated user is not a customer", async () => {
    // Arrange
    const { user } = await createOrganizer();

    // Act
    const response = await getMyPointBalance(signAccessToken(user));

    // Assert
    expect(response.status).toBe(403);
    expect(response.body).toEqual({ message: "Forbidden" });
  });
});
