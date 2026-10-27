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
  deletedAt?: Date | null;
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
      deletedAt: overrides.deletedAt ?? null,
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

async function createPointUsage(
  orderId: number,
  pointId: number,
  amount: number,
) {
  return prisma.pointUsage.create({
    data: {
      orderId,
      pointId,
      amount,
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

function getTransactionById(id: number | string, token?: string) {
  const req = request(app).get(`/api/transactions/${id}`);

  if (token !== undefined) {
    req.set("Authorization", `Bearer ${token}`);
  }

  return req;
}

describe("GET /transactions/:id", () => {
  it("should return the customer's transaction with its ticket, event, voucher, coupon and point usages", async () => {
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
    const coupon = await createCoupon(customer.id, {
      code: "WELCOME25",
      discountValue: 25_000,
    });
    const point = await createPoint(customer.id, { amount: 70_000 });
    const paidAt = new Date("2026-10-20T08:30:00.000Z");

    const order = await createOrder(customer.id, ticket.id, {
      quantity: 2,
      total: 200_000,
      pointsUsed: 30_000,
      discount: 75_000,
      finalPrice: 125_000,
      voucherId: voucher.id,
      couponId: coupon.id,
      paymentStatus: PaymentStatus.PAID,
      paymentProofUrl:
        "https://res.cloudinary.com/demo/image/upload/payment-proof.jpg",
      paidAt,
    });
    const pointUsage = await createPointUsage(order.id, point.id, 30_000);

    // Act
    const response = await getTransactionById(
      order.id,
      signAccessToken(customer),
    );

    // Assert
    expect(response.status).toBe(200);
    expect(response.body.message).toBe("Transaction retrieved successfully");

    const { data } = response.body;
    expect(data).toMatchObject({
      id: order.id,
      userId: customer.id,
      ticketId: ticket.id,
      quantity: 2,
      total: 200_000,
      pointsUsed: 30_000,
      discount: 75_000,
      finalPrice: 125_000,
      voucherId: voucher.id,
      couponId: coupon.id,
      paymentStatus: PaymentStatus.PAID,
      paymentProofUrl:
        "https://res.cloudinary.com/demo/image/upload/payment-proof.jpg",
      paidAt: paidAt.toISOString(),
      expiresAt: order.expiresAt!.toISOString(),
      createdAt: order.createdAt.toISOString(),
      updatedAt: order.updatedAt.toISOString(),
    });

    expect(data.ticket).toMatchObject({
      id: ticket.id,
      eventId: event.id,
      name: "VIP",
      price: 100_000,
      quantity: 100,
      availableQuantity: 90,
    });

    expect(data.ticket.event).toMatchObject({
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

    expect(data.ticket.event.category).toEqual({
      id: category.id,
      name: "Music",
      description: null,
    });

    expect(data.ticket.event.organization).toEqual({
      id: organization.id,
      userId: organizerUser.id,
      name: "Acme Events",
      logo: "https://res.cloudinary.com/demo/image/upload/logo.png",
      description: null,
      field: null,
    });

    expect(data.voucher).toEqual({
      id: voucher.id,
      eventId: event.id,
      code: "SAVE10",
      discountValue: 10,
      quota: 10,
      startDate: voucher.startDate.toISOString(),
      endDate: voucher.endDate.toISOString(),
      createdAt: voucher.createdAt.toISOString(),
    });

    expect(data.coupon).toEqual({
      id: coupon.id,
      userId: customer.id,
      code: "WELCOME25",
      discountValue: 25_000,
      isUsed: false,
      createdAt: coupon.createdAt.toISOString(),
      expiresAt: coupon.expiresAt.toISOString(),
    });

    expect(data.pointUsages).toEqual([
      {
        id: pointUsage.id,
        orderId: order.id,
        pointId: point.id,
        amount: 30_000,
        createdAt: pointUsage.createdAt.toISOString(),
      },
    ]);

    expect(JSON.stringify(response.body)).not.toContain("password");
  });

  it("should return only the requested transaction", async () => {
    // Arrange
    const customer = await createCustomer();
    const { organization } = await createOrganizer();
    const { ticket } = await createEvent(organization.id);

    const requestedOrder = await createOrder(customer.id, ticket.id, {
      quantity: 2,
      total: 200_000,
      finalPrice: 200_000,
    });
    const otherOrder = await createOrder(customer.id, ticket.id, {
      quantity: 3,
      total: 300_000,
      finalPrice: 300_000,
    });

    // Act
    const response = await getTransactionById(
      requestedOrder.id,
      signAccessToken(customer),
    );

    // Assert
    expect(response.status).toBe(200);
    expect(Array.isArray(response.body.data)).toBe(false);
    expect(response.body.data).toMatchObject({
      id: requestedOrder.id,
      quantity: 2,
      total: 200_000,
      finalPrice: 200_000,
    });
    expect(response.body.data.id).not.toBe(otherOrder.id);
  });

  it("should return 404 when the transaction belongs to another customer", async () => {
    // Arrange
    const customer = await createCustomer();
    const otherCustomer = await createCustomer();
    const { organization } = await createOrganizer();
    const { ticket } = await createEvent(organization.id);
    const otherOrder = await createOrder(otherCustomer.id, ticket.id, {
      quantity: 4,
      total: 400_000,
      finalPrice: 400_000,
    });

    // Act
    const response = await getTransactionById(
      otherOrder.id,
      signAccessToken(customer),
    );

    // Assert
    expect(response.status).toBe(404);
    expect(response.body).toEqual({ message: "Transaction not found" });
  });

  it("should return 404 when the transaction does not exist", async () => {
    // Arrange
    const customer = await createCustomer();

    // Act
    const response = await getTransactionById(
      999_999,
      signAccessToken(customer),
    );

    // Assert
    expect(response.status).toBe(404);
    expect(response.body).toEqual({ message: "Transaction not found" });
  });

  it("should still return the transaction when its event has been soft-deleted", async () => {
    // Arrange
    const customer = await createCustomer();
    const { organization } = await createOrganizer();
    const { event, ticket } = await createEvent(organization.id, {
      deletedAt: new Date(),
    });
    const order = await createOrder(customer.id, ticket.id);

    // Act
    const response = await getTransactionById(
      order.id,
      signAccessToken(customer),
    );

    // Assert
    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      id: order.id,
      userId: customer.id,
    });
    expect(response.body.data.ticket.event).toMatchObject({
      id: event.id,
      name: event.name,
    });
    expect(response.body.data.ticket.event.deletedAt).not.toBeNull();
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
    const response = await getTransactionById(
      order.id,
      loginResponse.body.accessToken,
    );

    // Assert
    expect(loginResponse.status).toBe(200);
    expect(response.status).toBe(200);
    expect(response.body.data.id).toBe(order.id);
  });

  it("should not expose customer credentials", async () => {
    // Arrange
    const customer = await createCustomer();
    const { organization } = await createOrganizer();
    const { ticket } = await createEvent(organization.id);
    const order = await createOrder(customer.id, ticket.id);

    // Act
    const response = await getTransactionById(
      order.id,
      signAccessToken(customer),
    );

    // Assert
    expect(response.status).toBe(200);
    expect(response.body.data).not.toHaveProperty("user");
    expect(JSON.stringify(response.body)).not.toContain("password");
    expect(JSON.stringify(response.body)).not.toContain(customer.email);
  });

  it("should return 401 when no token is provided", async () => {
    // Act
    const response = await getTransactionById(1);

    // Assert
    expect(response.status).toBe(401);
    expect(response.body).toEqual({ message: "Token not provided" });
  });

  it("should return 401 when the authorization header lacks the Bearer scheme", async () => {
    // Arrange
    const customer = await createCustomer();

    // Act
    const response = await request(app)
      .get("/api/transactions/1")
      .set("Authorization", signAccessToken(customer));

    // Assert
    expect(response.status).toBe(401);
    expect(response.body).toEqual({ message: "Token not provided" });
  });

  it("should return 401 for an invalid token", async () => {
    // Act
    const response = await getTransactionById(1, "not-a-real-token");

    // Assert
    expect(response.status).toBe(401);
    expect(response.body).toEqual({ message: "Invalid token" });
  });

  it("should return 401 for an expired token", async () => {
    // Arrange
    const customer = await createCustomer();
    const token = signAccessToken(customer, { expiresIn: -10 });

    // Act
    const response = await getTransactionById(1, token);

    // Assert
    expect(response.status).toBe(401);
    expect(response.body).toEqual({ message: "Token expired" });
  });

  it("should return 403 when the authenticated user is not a customer", async () => {
    // Arrange
    const { user } = await createOrganizer();

    // Act
    const response = await getTransactionById(1, signAccessToken(user));

    // Assert
    expect(response.status).toBe(403);
    expect(response.body).toEqual({ message: "Forbidden" });
  });

  const invalidTransactionIds: Array<[string, string]> = [
    ["non-numeric", "not-a-number"],
    ["decimal", "1.5"],
    ["zero", "0"],
    ["negative", "-1"],
    ["mixed alphanumeric", "12abc"],
  ];

  it.each(invalidTransactionIds)(
    "should return 400 for a %s transaction id",
    async (_case, id) => {
      // Arrange
      const customer = await createCustomer();

      // Act
      const response = await getTransactionById(id, signAccessToken(customer));

      // Assert
      expect(response.status).toBe(400);
      expect(response.body).toEqual({ message: "Invalid transaction ID" });
    },
  );
});
