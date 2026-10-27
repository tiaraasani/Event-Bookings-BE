import argon from "argon2";
import jwt from "jsonwebtoken";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  EventType,
  PaymentStatus,
  Role,
} from "../../../src/generated/prisma/enums.js";
import { prisma } from "../../../src/lib/prisma.js";

vi.mock("../../../src/lib/cloudinary.js", () => ({
  uploadImage: vi.fn(),
  removeImageByUrl: vi.fn(),
}));

import { app } from "../../../src/app.js";
import { uploadImage } from "../../../src/lib/cloudinary.js";

const DAY_IN_MS = 24 * 60 * 60 * 1000;
const HOUR_IN_MS = 60 * 60 * 1000;
const PAYMENT_PROOF_URL =
  "https://res.cloudinary.com/demo/image/upload/payment-proof.png";

type TestUserOverrides = {
  name?: string;
  email?: string;
  role?: Role;
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
  tickets?: TestTicketOverrides[];
};

type TestOrderOverrides = {
  quantity?: number;
  total?: number;
  pointsUsed?: number;
  discount?: number;
  finalPrice?: number;
  paymentStatus?: PaymentStatus;
  paymentProofUrl?: string | null;
  paidAt?: Date | null;
  expiresAt?: Date | null;
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
      paymentStatus:
        overrides.paymentStatus ?? PaymentStatus.WAITING_FOR_PAYMENT,
      paymentProofUrl: overrides.paymentProofUrl ?? null,
      paidAt: overrides.paidAt ?? null,
      expiresAt:
        overrides.expiresAt === undefined
          ? new Date(Date.now() + 2 * HOUR_IN_MS)
          : overrides.expiresAt,
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

function uploadPaymentProof(orderId: number | string, token?: string) {
  const req = request(app).post(
    `/api/transactions/${orderId}/payment-proof`,
  );

  if (token !== undefined) {
    req.set("Authorization", `Bearer ${token}`);
  }

  return req;
}

function attachPaymentProof(
  req: request.Test,
  overrides: { filename?: string; contentType?: string } = {},
) {
  return req.attach("image", Buffer.from("fake-image-bytes"), {
    filename: overrides.filename ?? "payment-proof.png",
    contentType: overrides.contentType ?? "image/png",
  });
}

describe("POST /transactions/:id/payment-proof", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should upload the payment proof and move the transaction to waiting for confirmation", async () => {
    // Arrange
    const customer = await createCustomer({ name: "Budi Santoso" });
    const { organization } = await createOrganizer();
    const { event, ticket } = await createEvent(organization.id, {
      name: "Jakarta Music Fest",
      tickets: [
        {
          name: "VIP",
          price: 250_000,
          quantity: 50,
          availableQuantity: 48,
        },
      ],
    });
    const order = await createOrder(customer.id, ticket.id, {
      quantity: 2,
      total: 500_000,
      finalPrice: 500_000,
    });
    vi.mocked(uploadImage).mockResolvedValue({
      secure_url: PAYMENT_PROOF_URL,
    });

    // Act
    const response = await attachPaymentProof(
      uploadPaymentProof(order.id, signAccessToken(customer)),
    );

    // Assert
    expect(response.status).toBe(200);
    expect(response.body.message).toBe("Payment proof uploaded successfully");
    expect(response.body.data).toMatchObject({
      id: order.id,
      userId: customer.id,
      ticketId: ticket.id,
      quantity: 2,
      total: 500_000,
      pointsUsed: 0,
      discount: 0,
      finalPrice: 500_000,
      paymentStatus: PaymentStatus.WAITING_FOR_CONFIRMATION,
      paymentProofUrl: PAYMENT_PROOF_URL,
      paidAt: null,
      expiresAt: order.expiresAt!.toISOString(),
    });
    expect(response.body.data.createdAt).toBe(order.createdAt.toISOString());

    expect(uploadImage).toHaveBeenCalledTimes(1);
    const [uploadedFile] = vi.mocked(uploadImage).mock.calls[0];
    expect(uploadedFile).toMatchObject({
      fieldname: "image",
      originalname: "payment-proof.png",
      mimetype: "image/png",
    });
    expect(uploadedFile.buffer.length).toBeGreaterThan(0);

    const savedOrder = await prisma.order.findUniqueOrThrow({
      where: { id: order.id },
    });
    expect(savedOrder.paymentStatus).toBe(
      PaymentStatus.WAITING_FOR_CONFIRMATION,
    );
    expect(savedOrder.paymentProofUrl).toBe(PAYMENT_PROOF_URL);
    expect(savedOrder.paidAt).toBeNull();

    const savedTicket = await prisma.ticket.findUniqueOrThrow({
      where: { id: ticket.id },
    });
    expect(savedTicket.availableQuantity).toBe(48);
    expect(savedTicket.eventId).toBe(event.id);
  });

  it("should only update the requested transaction", async () => {
    // Arrange
    const customer = await createCustomer();
    const { organization } = await createOrganizer();
    const { ticket } = await createEvent(organization.id);

    const targetOrder = await createOrder(customer.id, ticket.id);
    const untouchedOrder = await createOrder(customer.id, ticket.id, {
      quantity: 2,
      total: 200_000,
      finalPrice: 200_000,
    });
    vi.mocked(uploadImage).mockResolvedValue({
      secure_url: PAYMENT_PROOF_URL,
    });

    // Act
    const response = await attachPaymentProof(
      uploadPaymentProof(targetOrder.id, signAccessToken(customer)),
    );

    // Assert
    expect(response.status).toBe(200);

    const savedTarget = await prisma.order.findUniqueOrThrow({
      where: { id: targetOrder.id },
    });
    const savedUntouched = await prisma.order.findUniqueOrThrow({
      where: { id: untouchedOrder.id },
    });

    expect(savedTarget.paymentStatus).toBe(
      PaymentStatus.WAITING_FOR_CONFIRMATION,
    );
    expect(savedTarget.paymentProofUrl).toBe(PAYMENT_PROOF_URL);
    expect(savedUntouched.paymentStatus).toBe(
      PaymentStatus.WAITING_FOR_PAYMENT,
    );
    expect(savedUntouched.paymentProofUrl).toBeNull();
  });

  it("should return 404 when the transaction does not exist", async () => {
    // Arrange
    const customer = await createCustomer();
    vi.mocked(uploadImage).mockResolvedValue({
      secure_url: PAYMENT_PROOF_URL,
    });

    // Act
    const response = await attachPaymentProof(
      uploadPaymentProof(999_999, signAccessToken(customer)),
    );

    // Assert
    expect(response.status).toBe(404);
    expect(response.body).toEqual({ message: "Transaction not found" });
    expect(uploadImage).not.toHaveBeenCalled();
    expect(await prisma.order.count()).toBe(0);
  });

  it("should return 404 when the transaction belongs to another customer", async () => {
    // Arrange
    const customer = await createCustomer();
    const otherCustomer = await createCustomer();
    const { organization } = await createOrganizer();
    const { ticket } = await createEvent(organization.id);
    const otherOrder = await createOrder(otherCustomer.id, ticket.id);
    vi.mocked(uploadImage).mockResolvedValue({
      secure_url: PAYMENT_PROOF_URL,
    });

    // Act
    const response = await attachPaymentProof(
      uploadPaymentProof(otherOrder.id, signAccessToken(customer)),
    );

    // Assert
    expect(response.status).toBe(404);
    expect(response.body).toEqual({ message: "Transaction not found" });
    expect(uploadImage).not.toHaveBeenCalled();

    const savedOrder = await prisma.order.findUniqueOrThrow({
      where: { id: otherOrder.id },
    });
    expect(savedOrder.paymentStatus).toBe(
      PaymentStatus.WAITING_FOR_PAYMENT,
    );
    expect(savedOrder.paymentProofUrl).toBeNull();
  });

  const nonUploadableStatuses: PaymentStatus[] = [
    PaymentStatus.WAITING_FOR_CONFIRMATION,
    PaymentStatus.PAID,
    PaymentStatus.REJECTED,
    PaymentStatus.EXPIRED,
    PaymentStatus.CANCELED,
  ];

  it.each(nonUploadableStatuses)(
    "should return 400 when the transaction status is %s",
    async (paymentStatus) => {
      // Arrange
      const customer = await createCustomer();
      const { organization } = await createOrganizer();
      const { ticket } = await createEvent(organization.id);
      const order = await createOrder(customer.id, ticket.id, {
        paymentStatus,
      });
      vi.mocked(uploadImage).mockResolvedValue({
        secure_url: PAYMENT_PROOF_URL,
      });

      // Act
      const response = await attachPaymentProof(
        uploadPaymentProof(order.id, signAccessToken(customer)),
      );

      // Assert
      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        message:
          "Payment proof can only be uploaded while waiting for payment",
      });
      expect(uploadImage).not.toHaveBeenCalled();

      const savedOrder = await prisma.order.findUniqueOrThrow({
        where: { id: order.id },
      });
      expect(savedOrder.paymentStatus).toBe(paymentStatus);
      expect(savedOrder.paymentProofUrl).toBeNull();
    },
  );

  const unavailableDeadlines: Array<[string, Date | null]> = [
    ["the payment deadline has passed", new Date(Date.now() - HOUR_IN_MS)],
    ["the transaction has no payment deadline", null],
  ];

  it.each(unavailableDeadlines)(
    "should return 400 when %s",
    async (_case, expiresAt) => {
      // Arrange
      const customer = await createCustomer();
      const { organization } = await createOrganizer();
      const { ticket } = await createEvent(organization.id);
      const order = await createOrder(customer.id, ticket.id, { expiresAt });
      vi.mocked(uploadImage).mockResolvedValue({
        secure_url: PAYMENT_PROOF_URL,
      });

      // Act
      const response = await attachPaymentProof(
        uploadPaymentProof(order.id, signAccessToken(customer)),
      );

      // Assert
      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        message: "Payment deadline has expired",
      });
      expect(uploadImage).not.toHaveBeenCalled();

      const savedOrder = await prisma.order.findUniqueOrThrow({
        where: { id: order.id },
      });
      expect(savedOrder.paymentStatus).toBe(
        PaymentStatus.WAITING_FOR_PAYMENT,
      );
      expect(savedOrder.paymentProofUrl).toBeNull();
    },
  );

  it("should return 500 when no image is attached", async () => {
    // Arrange
    const customer = await createCustomer();
    const { organization } = await createOrganizer();
    const { ticket } = await createEvent(organization.id);
    const order = await createOrder(customer.id, ticket.id);

    // Act
    const response = await uploadPaymentProof(
      order.id,
      signAccessToken(customer),
    );

    // Assert
    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      message: "Payment proof image is required",
    });
    expect(uploadImage).not.toHaveBeenCalled();

    const savedOrder = await prisma.order.findUniqueOrThrow({
      where: { id: order.id },
    });
    expect(savedOrder.paymentStatus).toBe(
      PaymentStatus.WAITING_FOR_PAYMENT,
    );
    expect(savedOrder.paymentProofUrl).toBeNull();
  });

  it("should return 500 when the attached file is not an image", async () => {
    // Arrange
    const customer = await createCustomer();
    const { organization } = await createOrganizer();
    const { ticket } = await createEvent(organization.id);
    const order = await createOrder(customer.id, ticket.id);

    // Act
    const response = await attachPaymentProof(
      uploadPaymentProof(order.id, signAccessToken(customer)),
      { filename: "payment-proof.pdf", contentType: "application/pdf" },
    );

    // Assert
    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      message: "Only image files are allowed",
    });
    expect(uploadImage).not.toHaveBeenCalled();

    const savedOrder = await prisma.order.findUniqueOrThrow({
      where: { id: order.id },
    });
    expect(savedOrder.paymentStatus).toBe(
      PaymentStatus.WAITING_FOR_PAYMENT,
    );
    expect(savedOrder.paymentProofUrl).toBeNull();
  });

  it("should return 401 when no token is provided", async () => {
    // Act
    const response = await attachPaymentProof(uploadPaymentProof(1));

    // Assert
    expect(response.status).toBe(401);
    expect(response.body).toEqual({ message: "Token not provided" });
    expect(uploadImage).not.toHaveBeenCalled();
  });

  it("should return 401 for an invalid token", async () => {
    // Act
    const response = await attachPaymentProof(
      uploadPaymentProof(1, "not-a-real-token"),
    );

    // Assert
    expect(response.status).toBe(401);
    expect(response.body).toEqual({ message: "Invalid token" });
    expect(uploadImage).not.toHaveBeenCalled();
  });

  it("should return 401 for an expired token", async () => {
    // Arrange
    const customer = await createCustomer();
    const { organization } = await createOrganizer();
    const { ticket } = await createEvent(organization.id);
    const order = await createOrder(customer.id, ticket.id);
    const token = signAccessToken(customer, { expiresIn: -10 });

    // Act
    const response = await attachPaymentProof(
      uploadPaymentProof(order.id, token),
    );

    // Assert
    expect(response.status).toBe(401);
    expect(response.body).toEqual({ message: "Token expired" });
    expect(uploadImage).not.toHaveBeenCalled();
  });

  it("should return 403 when the authenticated user is not a customer", async () => {
    // Arrange
    const { user } = await createOrganizer();

    // Act
    const response = await attachPaymentProof(
      uploadPaymentProof(1, signAccessToken(user)),
    );

    // Assert
    expect(response.status).toBe(403);
    expect(response.body).toEqual({ message: "Forbidden" });
    expect(uploadImage).not.toHaveBeenCalled();
  });
});
