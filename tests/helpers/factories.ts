import argon from "argon2";
import jwt from "jsonwebtoken";
import {
  EventType,
  PaymentStatus,
  ReviewType,
  Role,
} from "../../src/generated/prisma/enums.js";
import { prisma } from "../../src/lib/prisma.js";

export const DAY_IN_MS = 24 * 60 * 60 * 1000;
export const HOUR_IN_MS = 60 * 60 * 1000;
export const TEST_PASSWORD = "Test123!";

let sequence = 0;
let passwordHashPromise: Promise<string> | undefined;

function nextSequence() {
  sequence += 1;
  return `${Date.now()}${sequence}`;
}

export function getPasswordHash() {
  passwordHashPromise ??= argon.hash(TEST_PASSWORD);
  return passwordHashPromise;
}

type UserOverrides = {
  name?: string;
  email?: string;
  role?: Role;
  picture?: string | null;
};

export async function createUser(overrides: UserOverrides = {}) {
  const id = nextSequence();

  return prisma.user.create({
    data: {
      name: overrides.name ?? "Test User",
      email: overrides.email ?? `user-${id}@mail.com`,
      password: await getPasswordHash(),
      role: overrides.role ?? Role.CUSTOMER,
      referralCode: `USER${id}`,
      picture: overrides.picture ?? null,
    },
  });
}

export function createCustomer(overrides: Omit<UserOverrides, "role"> = {}) {
  return createUser({ ...overrides, role: Role.CUSTOMER });
}

type OrganizerOverrides = {
  name?: string;
  email?: string;
  organizationName?: string;
};

export async function createOrganizer(overrides: OrganizerOverrides = {}) {
  const user = await createUser({
    name: overrides.name ?? "Event Organizer",
    email: overrides.email,
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

type TicketOverrides = {
  name?: string;
  price?: number;
  quantity?: number;
  availableQuantity?: number;
};

type EventOverrides = {
  name?: string;
  categoryName?: string;
  startDate?: Date;
  endDate?: Date;
  deletedAt?: Date | null;
  tickets?: TicketOverrides[];
};

export async function createEvent(
  organizationId: number,
  overrides: EventOverrides = {},
) {
  const id = nextSequence();

  const category = await prisma.category.create({
    data: { name: overrides.categoryName ?? `Category ${id}` },
  });

  const startDate = overrides.startDate ?? new Date(Date.now() + 7 * DAY_IN_MS);
  const endDate = overrides.endDate ?? new Date(startDate.getTime() + DAY_IN_MS);
  const tickets = overrides.tickets ?? [{}];

  const event = await prisma.event.create({
    data: {
      categoryId: category.id,
      organizationId,
      name: overrides.name ?? "Jakarta Music Fest",
      description: "A full-day music festival",
      city: "Jakarta",
      type: EventType.VENUE,
      slug: `event-${id}`,
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

/** An event whose dates are already in the past, so it can be reviewed. */
export function createEndedEvent(
  organizationId: number,
  overrides: EventOverrides = {},
) {
  return createEvent(organizationId, {
    startDate: new Date(Date.now() - 3 * DAY_IN_MS),
    endDate: new Date(Date.now() - 2 * DAY_IN_MS),
    ...overrides,
  });
}

type OrderOverrides = {
  quantity?: number;
  total?: number;
  pointsUsed?: number;
  discount?: number;
  finalPrice?: number;
  paymentStatus?: PaymentStatus;
  paymentProofUrl?: string | null;
  paidAt?: Date | null;
  expiresAt?: Date | null;
  couponId?: number | null;
  voucherId?: number | null;
};

export function createOrder(
  userId: number,
  ticketId: number,
  overrides: OrderOverrides = {},
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
      couponId: overrides.couponId ?? null,
      voucherId: overrides.voucherId ?? null,
    },
  });
}

/** A PAID order: the only kind that counts as attending an event. */
export function createPaidOrder(
  userId: number,
  ticketId: number,
  overrides: OrderOverrides = {},
) {
  return createOrder(userId, ticketId, {
    paymentStatus: PaymentStatus.PAID,
    paidAt: new Date(),
    expiresAt: null,
    ...overrides,
  });
}

type ReviewOverrides = {
  type?: ReviewType;
  rating?: number;
  title?: string;
  comment?: string;
};

export function createReview(orderId: number, overrides: ReviewOverrides = {}) {
  return prisma.review.create({
    data: {
      orderId,
      type: overrides.type ?? ReviewType.EVENT,
      rating: overrides.rating ?? 5,
      title: overrides.title ?? "Great event",
      comment: overrides.comment ?? "Everything was well organized and fun.",
    },
  });
}

type VoucherOverrides = {
  code?: string;
  discountValue?: number;
  quota?: number;
  startDate?: Date;
  endDate?: Date;
};

export function createVoucher(
  eventId: number,
  overrides: VoucherOverrides = {},
) {
  const id = nextSequence();
  const startDate = overrides.startDate ?? new Date(Date.now() - DAY_IN_MS);

  return prisma.voucher.create({
    data: {
      eventId,
      code: overrides.code ?? `PROMO${id}`,
      discountValue: overrides.discountValue ?? 10,
      quota: overrides.quota ?? 10,
      startDate,
      endDate:
        overrides.endDate ?? new Date(startDate.getTime() + 30 * DAY_IN_MS),
    },
  });
}

type PointOverrides = {
  amount?: number;
  expiresAt?: Date;
};

export function createPoint(userId: number, overrides: PointOverrides = {}) {
  return prisma.point.create({
    data: {
      userId,
      amount: overrides.amount ?? 10_000,
      expiresAt: overrides.expiresAt ?? new Date(Date.now() + 90 * DAY_IN_MS),
    },
  });
}

type CouponOverrides = {
  discountValue?: number;
  isUsed?: boolean;
  expiresAt?: Date;
};

export function createCoupon(userId: number, overrides: CouponOverrides = {}) {
  const id = nextSequence();

  return prisma.coupon.create({
    data: {
      userId,
      code: `COUPON${id}`,
      discountValue: overrides.discountValue ?? 10_000,
      isUsed: overrides.isUsed ?? false,
      expiresAt: overrides.expiresAt ?? new Date(Date.now() + 90 * DAY_IN_MS),
    },
  });
}

export function signAccessToken(
  user: { id: number; role: Role },
  options: jwt.SignOptions = {},
) {
  return jwt.sign({ id: user.id, role: user.role }, process.env.JWT_SECRET!, {
    expiresIn: "1h",
    ...options,
  });
}

export function signExpiredToken(user: { id: number; role: Role }) {
  return signAccessToken(user, { expiresIn: "-1s" });
}

/** Smallest valid PNG (1x1 pixel). `file-type` recognises it as image/png. */
export const PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);
