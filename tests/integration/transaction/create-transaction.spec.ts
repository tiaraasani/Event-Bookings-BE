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
  referralCode?: string;
};

type TestOrganizerOverrides = {
  name?: string;
  email?: string;
  organizationName?: string;
};

type TestTicketOverrides = {
  name?: string;
  price?: number;
  quantity?: number;
  availableQuantity?: number;
};

type TestEventOverrides = {
  name?: string;
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

type TestPointOverrides = {
  amount?: number;
  expiresAt?: Date;
  orderId?: number;
};

type TestTransactionPayload = {
  ticketId: number;
  quantity?: number;
  pointsToUse?: number;
  voucherCode?: string;
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
      referralCode:
        overrides.referralCode ?? `USER${Date.now()}${sequence}`,
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
      description: "A full-day music festival",
      city: "Jakarta",
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

async function createPoint(
  userId: number,
  overrides: TestPointOverrides = {},
) {
  return prisma.point.create({
    data: {
      userId,
      amount: overrides.amount ?? 100_000,
      expiresAt: overrides.expiresAt ?? new Date(Date.now() + 7 * DAY_IN_MS),
      ...(overrides.orderId !== undefined && { orderId: overrides.orderId }),
    },
  });
}

function signAccessToken(user: { id: number; role: Role }) {
  return jwt.sign({ id: user.id, role: user.role }, process.env.JWT_SECRET!, {
    expiresIn: "1h",
  });
}

function buildTransactionPayload({
  ticketId,
  quantity = 1,
  pointsToUse,
  voucherCode,
}: TestTransactionPayload) {
  return {
    ticketId,
    quantity,
    ...(pointsToUse !== undefined && { pointsToUse }),
    ...(voucherCode !== undefined && { voucherCode }),
  };
}

function postTransaction(token?: string) {
  const req = request(app).post("/api/transactions");

  if (token !== undefined) {
    req.set("Authorization", `Bearer ${token}`);
  }

  return req;
}

describe("POST /transactions", () => {
  it("should create a transaction for an available ticket", async () => {
    // Arrange
    const customer = await createCustomer();
    const { organization } = await createOrganizer();
    const { event, ticket } = await createEvent(organization.id, {
      tickets: [
        {
          name: "General Admission",
          price: 100_000,
          quantity: 100,
          availableQuantity: 100,
        },
      ],
    });

    // Act
    const response = await postTransaction(signAccessToken(customer)).send(
      buildTransactionPayload({ ticketId: ticket.id, quantity: 2 }),
    );

    // Assert
    expect(response.status).toBe(201);
    expect(response.body.message).toBe("Transaction created successfully");

    const { data } = response.body;
    expect(data).toMatchObject({
      id: expect.any(Number),
      userId: customer.id,
      ticketId: ticket.id,
      quantity: 2,
      total: 200_000,
      pointsUsed: 0,
      discount: 0,
      finalPrice: 200_000,
      voucherId: null,
      couponId: null,
      paymentProofUrl: null,
      paidAt: null,
      paymentStatus: PaymentStatus.WAITING_FOR_PAYMENT,
    });

    expect(data.ticket).toMatchObject({
      id: ticket.id,
      eventId: event.id,
      name: "General Admission",
      price: 100_000,
      quantity: 100,
      availableQuantity: 98,
    });
    expect(data.ticket.event).toMatchObject({
      id: event.id,
      name: "Jakarta Music Fest",
    });
    expect(data.voucher).toBeNull();
    expect(data.pointUsages).toEqual([]);

    const expiresAt = new Date(data.expiresAt).getTime();
    expect(expiresAt).toBeGreaterThanOrEqual(
      Date.now() + 2 * HOUR_IN_MS - 10_000,
    );
    expect(expiresAt).toBeLessThanOrEqual(
      Date.now() + 2 * HOUR_IN_MS + 10_000,
    );

    const savedOrder = await prisma.order.findUniqueOrThrow({
      where: { id: data.id },
    });
    expect(savedOrder.paymentStatus).toBe(PaymentStatus.WAITING_FOR_PAYMENT);
    expect(savedOrder.finalPrice).toBe(200_000);

    const savedTicket = await prisma.ticket.findUniqueOrThrow({
      where: { id: ticket.id },
    });
    expect(savedTicket.availableQuantity).toBe(98);
  });

  it("should create the transaction for the authenticated customer", async () => {
    // Arrange
    const customer = await createCustomer();
    const otherCustomer = await createCustomer();
    const { organization } = await createOrganizer();
    const { ticket } = await createEvent(organization.id);

    // Act
    const response = await postTransaction(signAccessToken(customer)).send({
      ...buildTransactionPayload({ ticketId: ticket.id }),
      userId: otherCustomer.id,
    });

    // Assert
    expect(response.status).toBe(201);
    expect(response.body.data.userId).toBe(customer.id);

    const savedOrder = await prisma.order.findUniqueOrThrow({
      where: { id: response.body.data.id },
    });
    expect(savedOrder.userId).toBe(customer.id);
  });

  it("should apply a voucher discount and normalize the voucher code", async () => {
    // Arrange
    const customer = await createCustomer();
    const { organization } = await createOrganizer();
    const { event, ticket } = await createEvent(organization.id, {
      tickets: [{ price: 100_000, quantity: 100 }],
    });
    const voucher = await createVoucher(event.id, {
      code: "SAVE25",
      discountValue: 25,
      quota: 10,
    });

    // Act
    const response = await postTransaction(signAccessToken(customer)).send(
      buildTransactionPayload({
        ticketId: ticket.id,
        quantity: 2,
        voucherCode: "  save25  ",
      }),
    );

    // Assert
    expect(response.status).toBe(201);

    const { data } = response.body;
    expect(data).toMatchObject({
      userId: customer.id,
      ticketId: ticket.id,
      quantity: 2,
      total: 200_000,
      voucherId: voucher.id,
      pointsUsed: 0,
      discount: 50_000,
      finalPrice: 150_000,
    });
    expect(data.voucher).toMatchObject({
      id: voucher.id,
      eventId: event.id,
      code: "SAVE25",
      discountValue: 25,
      quota: 10,
    });

    const savedOrder = await prisma.order.findUniqueOrThrow({
      where: { id: data.id },
    });
    expect(savedOrder.voucherId).toBe(voucher.id);
    expect(savedOrder.discount).toBe(50_000);
    expect(savedOrder.finalPrice).toBe(150_000);
  });

  it("should redeem points in expiry order and record point usages", async () => {
    // Arrange
    const customer = await createCustomer();
    const { organization } = await createOrganizer();
    const { ticket } = await createEvent(organization.id, {
      tickets: [{ price: 100_000, quantity: 100 }],
    });

    const firstExpiringPoint = await createPoint(customer.id, {
      amount: 40,
      expiresAt: new Date(Date.now() + 2 * DAY_IN_MS),
    });
    const secondExpiringPoint = await createPoint(customer.id, {
      amount: 60,
      expiresAt: new Date(Date.now() + 5 * DAY_IN_MS),
    });
    const lastExpiringPoint = await createPoint(customer.id, {
      amount: 100,
      expiresAt: new Date(Date.now() + 10 * DAY_IN_MS),
    });

    // Act
    const response = await postTransaction(signAccessToken(customer)).send(
      buildTransactionPayload({
        ticketId: ticket.id,
        pointsToUse: 90,
      }),
    );

    // Assert
    expect(response.status).toBe(201);

    const { data } = response.body;
    expect(data).toMatchObject({
      ticketId: ticket.id,
      total: 100_000,
      pointsUsed: 90,
      discount: 90,
      finalPrice: 99_910,
    });
    expect(data.pointUsages).toHaveLength(2);
    expect(data.pointUsages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          orderId: data.id,
          pointId: firstExpiringPoint.id,
          amount: 40,
        }),
        expect.objectContaining({
          orderId: data.id,
          pointId: secondExpiringPoint.id,
          amount: 50,
        }),
      ]),
    );

    const points = await prisma.point.findMany({
      where: { userId: customer.id },
      orderBy: { id: "asc" },
    });
    expect(points.map((point) => point.amount)).toEqual([0, 10, 100]);

    const pointUsages = await prisma.pointUsage.findMany({
      where: { orderId: data.id },
    });
    expect(pointUsages).toHaveLength(2);
  });

  it("should combine a voucher discount with points", async () => {
    // Arrange
    const customer = await createCustomer();
    const { organization } = await createOrganizer();
    const { event, ticket } = await createEvent(organization.id, {
      tickets: [{ price: 100_000, quantity: 100 }],
    });
    await createVoucher(event.id, {
      code: "TENOFF",
      discountValue: 10,
    });
    const point = await createPoint(customer.id, { amount: 50_000 });

    // Act
    const response = await postTransaction(signAccessToken(customer)).send(
      buildTransactionPayload({
        ticketId: ticket.id,
        quantity: 2,
        pointsToUse: 30_000,
        voucherCode: "TENOFF",
      }),
    );

    // Assert
    expect(response.status).toBe(201);

    const { data } = response.body;
    expect(data).toMatchObject({
      total: 200_000,
      pointsUsed: 30_000,
      discount: 50_000,
      finalPrice: 150_000,
    });

    const savedPoint = await prisma.point.findUniqueOrThrow({
      where: { id: point.id },
    });
    expect(savedPoint.amount).toBe(20_000);
    expect(data.pointUsages).toHaveLength(1);
    expect(data.pointUsages[0]).toMatchObject({
      orderId: data.id,
      pointId: point.id,
      amount: 30_000,
    });
  });

  it("should allow points equal to the amount due after the voucher discount", async () => {
    // Arrange
    const customer = await createCustomer();
    const { organization } = await createOrganizer();
    const { event, ticket } = await createEvent(organization.id, {
      tickets: [{ price: 100_000, quantity: 100 }],
    });
    await createVoucher(event.id, {
      code: "HALFOFF",
      discountValue: 50,
    });
    await createPoint(customer.id, { amount: 50_000 });

    // Act
    const response = await postTransaction(signAccessToken(customer)).send(
      buildTransactionPayload({
        ticketId: ticket.id,
        pointsToUse: 50_000,
        voucherCode: "HALFOFF",
      }),
    );

    // Assert
    expect(response.status).toBe(201);
    expect(response.body.data).toMatchObject({
      total: 100_000,
      discount: 100_000,
      finalPrice: 0,
    });
  });

  it("should ignore expired points and points with no balance", async () => {
    // Arrange
    const customer = await createCustomer();
    const { organization } = await createOrganizer();
    const { ticket } = await createEvent(organization.id);

    const validPoint = await createPoint(customer.id, { amount: 10 });
    const expiredPoint = await createPoint(customer.id, {
      amount: 100,
      expiresAt: new Date(Date.now() - DAY_IN_MS),
    });
    const emptyPoint = await createPoint(customer.id, { amount: 0 });

    // Act
    const response = await postTransaction(signAccessToken(customer)).send(
      buildTransactionPayload({ ticketId: ticket.id, pointsToUse: 10 }),
    );

    // Assert
    expect(response.status).toBe(201);
    expect(response.body.data.pointsUsed).toBe(10);
    expect(response.body.data.pointUsages).toHaveLength(1);
    expect(response.body.data.pointUsages[0].pointId).toBe(validPoint.id);

    const points = await prisma.point.findMany({
      where: { userId: customer.id },
      orderBy: { id: "asc" },
    });
    expect(points.map((point) => point.amount)).toEqual([0, 100, 0]);
    expect(points[1].id).toBe(expiredPoint.id);
    expect(points[2].id).toBe(emptyPoint.id);
  });

  it("should reserve the last ticket only once when two transactions race", async () => {
    // Arrange
    const customer = await createCustomer();
    const { organization } = await createOrganizer();
    const { ticket } = await createEvent(organization.id, {
      tickets: [{ quantity: 1, availableQuantity: 1 }],
    });
    const token = signAccessToken(customer);

    // Act
    const responses = await Promise.all([
      postTransaction(token).send(
        buildTransactionPayload({ ticketId: ticket.id }),
      ),
      postTransaction(token).send(
        buildTransactionPayload({ ticketId: ticket.id }),
      ),
    ]);

    // Assert
    expect(responses.map((response) => response.status).sort()).toEqual([
      201, 400,
    ]);

    const rejected = responses.find((response) => response.status === 400);
    expect(rejected?.body).toEqual({
      message: "Not enough tickets available",
    });

    const savedTicket = await prisma.ticket.findUniqueOrThrow({
      where: { id: ticket.id },
    });
    expect(savedTicket.availableQuantity).toBe(0);
    expect(await prisma.order.count()).toBe(1);
  });

  it("should return 404 when the ticket does not exist", async () => {
    // Arrange
    const customer = await createCustomer();

    // Act
    const response = await postTransaction(signAccessToken(customer)).send(
      buildTransactionPayload({ ticketId: 999_999 }),
    );

    // Assert
    expect(response.status).toBe(404);
    expect(response.body).toEqual({ message: "Ticket or event not found" });
    expect(await prisma.order.count()).toBe(0);
  });

  it("should return 404 when the event has been deleted", async () => {
    // Arrange
    const customer = await createCustomer();
    const { organization } = await createOrganizer();
    const { ticket } = await createEvent(organization.id, {
      deletedAt: new Date(),
    });

    // Act
    const response = await postTransaction(signAccessToken(customer)).send(
      buildTransactionPayload({ ticketId: ticket.id }),
    );

    // Assert
    expect(response.status).toBe(404);
    expect(response.body).toEqual({ message: "Ticket or event not found" });
    expect(await prisma.order.count()).toBe(0);
  });

  it("should return 400 when the event has already ended", async () => {
    // Arrange
    const customer = await createCustomer();
    const { organization } = await createOrganizer();
    const { ticket } = await createEvent(organization.id, {
      startDate: new Date(Date.now() - 2 * DAY_IN_MS),
      endDate: new Date(Date.now() - DAY_IN_MS),
    });

    // Act
    const response = await postTransaction(signAccessToken(customer)).send(
      buildTransactionPayload({ ticketId: ticket.id }),
    );

    // Assert
    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      message: "This event has already ended",
    });
    expect(await prisma.order.count()).toBe(0);
  });

  it("should return 400 when there are not enough tickets available", async () => {
    // Arrange
    const customer = await createCustomer();
    const { organization } = await createOrganizer();
    const { ticket } = await createEvent(organization.id, {
      tickets: [{ quantity: 10, availableQuantity: 3 }],
    });

    // Act
    const response = await postTransaction(signAccessToken(customer)).send(
      buildTransactionPayload({ ticketId: ticket.id, quantity: 4 }),
    );

    // Assert
    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      message: "Not enough tickets available",
    });

    const savedTicket = await prisma.ticket.findUniqueOrThrow({
      where: { id: ticket.id },
    });
    expect(savedTicket.availableQuantity).toBe(3);
    expect(await prisma.order.count()).toBe(0);
  });

  it("should return 400 for an invalid voucher code", async () => {
    // Arrange
    const customer = await createCustomer();
    const { organization } = await createOrganizer();
    const { ticket } = await createEvent(organization.id);

    // Act
    const response = await postTransaction(signAccessToken(customer)).send(
      buildTransactionPayload({
        ticketId: ticket.id,
        voucherCode: "DOES-NOT-EXIST",
      }),
    );

    // Assert
    expect(response.status).toBe(400);
    expect(response.body).toEqual({ message: "Invalid voucher code" });
    expect(await prisma.order.count()).toBe(0);
  });

  it("should return 400 when the voucher belongs to another event", async () => {
    // Arrange
    const customer = await createCustomer();
    const { organization } = await createOrganizer();
    const { ticket } = await createEvent(organization.id);
    const { event: otherEvent } = await createEvent(organization.id);
    const otherVoucher = await createVoucher(otherEvent.id, {
      code: "OTHER-EVENT",
    });

    // Act
    const response = await postTransaction(signAccessToken(customer)).send(
      buildTransactionPayload({
        ticketId: ticket.id,
        voucherCode: otherVoucher.code,
      }),
    );

    // Assert
    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      message: "This voucher is not valid for this event",
    });
    expect(await prisma.order.count()).toBe(0);
  });

  const inactiveVoucherDates: Array<
    [string, { startDate: Date; endDate: Date }]
  > = [
    [
      "not started yet",
      {
        startDate: new Date(Date.now() + DAY_IN_MS),
        endDate: new Date(Date.now() + 7 * DAY_IN_MS),
      },
    ],
    [
      "already expired",
      {
        startDate: new Date(Date.now() - 7 * DAY_IN_MS),
        endDate: new Date(Date.now() - DAY_IN_MS),
      },
    ],
  ];

  it.each(inactiveVoucherDates)(
    "should return 400 when the voucher is %s",
    async (_case, dates) => {
      // Arrange
      const customer = await createCustomer();
      const { organization } = await createOrganizer();
      const { event, ticket } = await createEvent(organization.id);
      const voucher = await createVoucher(event.id, {
        code: "NOT-ACTIVE",
        ...dates,
      });

      // Act
      const response = await postTransaction(signAccessToken(customer)).send(
        buildTransactionPayload({
          ticketId: ticket.id,
          voucherCode: voucher.code,
        }),
      );

      // Assert
      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        message: "This voucher is not currently valid",
      });
      expect(await prisma.order.count()).toBe(0);
    },
  );

  it("should return 400 when the voucher has reached its quota", async () => {
    // Arrange
    const customer = await createCustomer();
    const { organization } = await createOrganizer();
    const { event, ticket } = await createEvent(organization.id);
    const voucher = await createVoucher(event.id, {
      code: "ONE-ONLY",
      quota: 1,
    });

    await prisma.order.create({
      data: {
        userId: customer.id,
        ticketId: ticket.id,
        quantity: 1,
        total: 100_000,
        finalPrice: 90_000,
        voucherId: voucher.id,
        paymentStatus: PaymentStatus.PAID,
      },
    });

    // Act
    const response = await postTransaction(signAccessToken(customer)).send(
      buildTransactionPayload({
        ticketId: ticket.id,
        voucherCode: voucher.code,
      }),
    );

    // Assert
    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      message: "This voucher has reached its quota",
    });
    expect(await prisma.order.count()).toBe(1);
  });

  it("should return 400 when points exceed the total after the voucher discount", async () => {
    // Arrange
    const customer = await createCustomer();
    const { organization } = await createOrganizer();
    const { event, ticket } = await createEvent(organization.id, {
      tickets: [{ price: 100_000, quantity: 100 }],
    });
    await createVoucher(event.id, {
      code: "HALFOFF",
      discountValue: 50,
    });
    const point = await createPoint(customer.id, { amount: 100_000 });

    // Act
    const response = await postTransaction(signAccessToken(customer)).send(
      buildTransactionPayload({
        ticketId: ticket.id,
        pointsToUse: 60_000,
        voucherCode: "HALFOFF",
      }),
    );

    // Assert
    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      message: "Points cannot exceed the ticket total after voucher discount",
    });

    const savedPoint = await prisma.point.findUniqueOrThrow({
      where: { id: point.id },
    });
    expect(savedPoint.amount).toBe(100_000);

    const savedTicket = await prisma.ticket.findUniqueOrThrow({
      where: { id: ticket.id },
    });
    expect(savedTicket.availableQuantity).toBe(100);
    expect(await prisma.order.count()).toBe(0);
    expect(await prisma.pointUsage.count()).toBe(0);
  });

  it("should return 400 when the points balance is insufficient", async () => {
    // Arrange
    const customer = await createCustomer();
    const { organization } = await createOrganizer();
    const { ticket } = await createEvent(organization.id, {
      tickets: [{ price: 100_000, quantity: 100 }],
    });
    const point = await createPoint(customer.id, { amount: 50_000 });

    // Act
    const response = await postTransaction(signAccessToken(customer)).send(
      buildTransactionPayload({
        ticketId: ticket.id,
        pointsToUse: 60_000,
      }),
    );

    // Assert
    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      message: "Insufficient points balance",
    });

    const savedPoint = await prisma.point.findUniqueOrThrow({
      where: { id: point.id },
    });
    expect(savedPoint.amount).toBe(50_000);

    const savedTicket = await prisma.ticket.findUniqueOrThrow({
      where: { id: ticket.id },
    });
    expect(savedTicket.availableQuantity).toBe(100);
    expect(await prisma.order.count()).toBe(0);
  });

  it("should return 401 when no token is provided", async () => {
    // Act
    const response = await postTransaction().send(
      buildTransactionPayload({ ticketId: 1 }),
    );

    // Assert
    expect(response.status).toBe(401);
    expect(response.body).toEqual({ message: "Token not provided" });
  });

  it("should return 401 for an invalid token", async () => {
    // Act
    const response = await postTransaction("not-a-real-token").send(
      buildTransactionPayload({ ticketId: 1 }),
    );

    // Assert
    expect(response.status).toBe(401);
    expect(response.body).toEqual({ message: "Invalid token" });
  });

  it("should return 403 when the authenticated user is not a customer", async () => {
    // Arrange
    const { user } = await createOrganizer();

    // Act
    const response = await postTransaction(signAccessToken(user)).send(
      buildTransactionPayload({ ticketId: 1 }),
    );

    // Assert
    expect(response.status).toBe(403);
    expect(response.body).toEqual({ message: "Forbidden" });
  });

  const invalidPayloads: Array<[string, Record<string, unknown>, string]> = [
    [
      "the ticket id is missing",
      { quantity: 1 },
      "ticketId:",
    ],
    [
      "the ticket id is not positive",
      { ticketId: 0, quantity: 1 },
      "ticketId: Too small",
    ],
    [
      "the quantity is missing",
      { ticketId: 1 },
      "quantity:",
    ],
    [
      "the quantity is zero",
      { ticketId: 1, quantity: 0 },
      "quantity: Too small",
    ],
    [
      "the quantity exceeds the maximum",
      { ticketId: 1, quantity: 11 },
      "quantity: Too big",
    ],
    [
      "the points to use is negative",
      { ticketId: 1, quantity: 1, pointsToUse: -1 },
      "pointsToUse: Too small",
    ],
  ];

  it.each(invalidPayloads)(
    "should return 400 when %s",
    async (_case, payload, expectedMessage) => {
      // Arrange
      const customer = await createCustomer();

      // Act
      const response = await postTransaction(
        signAccessToken(customer),
      ).send(payload);

      // Assert
      expect(response.status).toBe(400);
      expect(response.body.message).toContain(expectedMessage);
      expect(await prisma.order.count()).toBe(0);
    },
  );
});
