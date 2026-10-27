import argon from "argon2";
import jwt from "jsonwebtoken";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { EventType, Role } from "../../../src/generated/prisma/enums.js";
import { prisma } from "../../../src/lib/prisma.js";
import { app } from "../../../src/app.js";

const DAY_IN_MS = 24 * 60 * 60 * 1000;

type TestTicketOverrides = {
  name: string;
  price: number;
  quantity: number;
  availableQuantity?: number;
};

type TestEventOverrides = {
  name?: string;
  description?: string | null;
  city?: string;
  type?: EventType;
  slug?: string;
  image?: string | null;
  startDate?: Date;
  endDate?: Date;
  deletedAt?: Date | null;
  categoryName?: string;
  tickets?: TestTicketOverrides[];
};

type TestOrganizerOverrides = {
  name?: string;
  email?: string;
  organizationName?: string;
  organizationLogo?: string | null;
  withOrganization?: boolean;
};

let sequence = 0;

async function createOrganizer(overrides: TestOrganizerOverrides = {}) {
  sequence += 1;

  const user = await prisma.user.create({
    data: {
      name: overrides.name ?? "Event Organizer",
      email: overrides.email ?? `organizer-${Date.now()}-${sequence}@mail.com`,
      password: await argon.hash("Test123!"),
      role: Role.ORGANIZER,
      referralCode: `ORGANIZER${Date.now()}${sequence}`,
    },
  });

  if (overrides.withOrganization === false) {
    return { user, organization: null };
  }

  const organization = await prisma.organization.create({
    data: {
      userId: user.id,
      name: overrides.organizationName ?? "Acme Events",
      logo: overrides.organizationLogo ?? null,
    },
  });

  return { user, organization };
}

async function createCustomer() {
  sequence += 1;

  return prisma.user.create({
    data: {
      name: "Test Customer",
      email: `customer-${Date.now()}-${sequence}@mail.com`,
      password: await argon.hash("Test123!"),
      role: Role.CUSTOMER,
      referralCode: `CUSTOMER${Date.now()}${sequence}`,
    },
  });
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

  const startDate =
    overrides.startDate ?? new Date(Date.now() + 7 * DAY_IN_MS);
  const endDate =
    overrides.endDate ?? new Date(startDate.getTime() + DAY_IN_MS);

  const tickets = overrides.tickets ?? [
    { name: "General Admission", price: 100_000, quantity: 100 },
  ];

  const event = await prisma.event.create({
    data: {
      categoryId: category.id,
      organizationId,
      name: overrides.name ?? "Test Event",
      description: overrides.description ?? "A test event",
      city: overrides.city ?? "Jakarta",
      type: overrides.type ?? EventType.VENUE,
      slug: overrides.slug ?? `test-event-${Date.now()}-${sequence}`,
      image: overrides.image ?? null,
      startDate,
      endDate,
      deletedAt: overrides.deletedAt ?? null,
      tickets: {
        create: tickets.map((ticket) => ({
          name: ticket.name,
          price: ticket.price,
          quantity: ticket.quantity,
          availableQuantity: ticket.availableQuantity ?? ticket.quantity,
        })),
      },
    },
    include: {
      category: true,
      tickets: true,
    },
  });

  return { event, category };
}

function signAccessToken(user: { id: number; role: Role }) {
  return jwt.sign({ id: user.id, role: user.role }, process.env.JWT_SECRET!, {
    expiresIn: "1h",
  });
}

function deleteEvent(id: number, token?: string) {
  const req = request(app).delete(`/api/events/${id}`);

  if (token !== undefined) {
    req.set("Authorization", `Bearer ${token}`);
  }

  return req;
}

describe("DELETE /events/:id", () => {
  it("should soft-delete an event and return a success message", async () => {
    // Arrange
    const { user, organization } = await createOrganizer();
    const { event } = await createEvent(organization!.id, {
      name: "Jakarta Music Fest",
      tickets: [
        { name: "General Admission", price: 100_000, quantity: 100 },
        { name: "VIP", price: 250_000, quantity: 20, availableQuantity: 15 },
      ],
    });
    const beforeDelete = Date.now();

    // Act
    const response = await deleteEvent(event.id, signAccessToken(user));

    // Assert
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      message: "Event deleted successfully",
      data: { message: "Event deleted successfully" },
    });

    const savedEvent = await prisma.event.findUniqueOrThrow({
      where: { id: event.id },
      include: { tickets: true },
    });
    expect(savedEvent.name).toBe("Jakarta Music Fest");
    expect(savedEvent.deletedAt).toBeInstanceOf(Date);
    expect(savedEvent.deletedAt!.getTime()).toBeGreaterThanOrEqual(
      beforeDelete,
    );
    expect(savedEvent.deletedAt!.getTime()).toBeLessThanOrEqual(Date.now());
    expect(savedEvent.tickets).toHaveLength(2);

    const publicResponse = await request(app).get(`/api/events/${event.id}`);
    expect(publicResponse.status).toBe(404);
    expect(publicResponse.body).toEqual({ message: "Event not found" });
  });

  it("should only delete the requested event", async () => {
    // Arrange
    const { user, organization } = await createOrganizer();
    const deleted = await createEvent(organization!.id, {
      name: "Event To Delete",
    });
    const untouched = await createEvent(organization!.id, {
      name: "Event To Keep",
    });
    const otherOrganizer = await createOrganizer({
      organizationName: "Other Events",
    });
    const otherEvent = await createEvent(otherOrganizer.organization!.id, {
      name: "Other Organizer Event",
    });

    // Act
    const response = await deleteEvent(
      deleted.event.id,
      signAccessToken(user),
    );

    // Assert
    expect(response.status).toBe(200);

    const savedDeleted = await prisma.event.findUniqueOrThrow({
      where: { id: deleted.event.id },
    });
    const savedUntouched = await prisma.event.findUniqueOrThrow({
      where: { id: untouched.event.id },
    });
    const savedOther = await prisma.event.findUniqueOrThrow({
      where: { id: otherEvent.event.id },
    });

    expect(savedDeleted.deletedAt).toBeInstanceOf(Date);
    expect(savedUntouched.deletedAt).toBeNull();
    expect(savedOther.deletedAt).toBeNull();
  });

  it("should exclude the deleted event from public and organizer listings", async () => {
    // Arrange
    const { user, organization } = await createOrganizer();
    const deleted = await createEvent(organization!.id, {
      name: "Deleted Event",
    });
    const remaining = await createEvent(organization!.id, {
      name: "Remaining Event",
    });

    // Act
    const response = await deleteEvent(
      deleted.event.id,
      signAccessToken(user),
    );

    const publicResponse = await request(app).get("/api/events");
    const myEventsResponse = await request(app)
      .get("/api/events/my")
      .set("Authorization", `Bearer ${signAccessToken(user)}`);

    // Assert
    expect(response.status).toBe(200);

    expect(publicResponse.status).toBe(200);
    expect(
      publicResponse.body.data.map((event: { id: number }) => event.id),
    ).toEqual([remaining.event.id]);

    expect(myEventsResponse.status).toBe(200);
    expect(
      myEventsResponse.body.data.map((event: { id: number }) => event.id),
    ).toEqual([remaining.event.id]);
  });

  it("should return 404 when the event is already soft-deleted", async () => {
    // Arrange
    const { user, organization } = await createOrganizer();
    const deletedAt = new Date(Date.now() - DAY_IN_MS);
    const { event } = await createEvent(organization!.id, {
      name: "Already Deleted Event",
      deletedAt,
    });

    // Act
    const response = await deleteEvent(event.id, signAccessToken(user));

    // Assert
    expect(response.status).toBe(404);
    expect(response.body).toEqual({ message: "Event not found" });

    const savedEvent = await prisma.event.findUniqueOrThrow({
      where: { id: event.id },
    });
    expect(savedEvent.deletedAt?.getTime()).toBe(deletedAt.getTime());
  });

  it("should return 404 when the event does not exist", async () => {
    // Arrange
    const { user } = await createOrganizer();

    // Act
    const response = await deleteEvent(999999999, signAccessToken(user));

    // Assert
    expect(response.status).toBe(404);
    expect(response.body).toEqual({ message: "Event not found" });
  });

  it("should return 404 when the event belongs to another organizer", async () => {
    // Arrange
    const owner = await createOrganizer({ organizationName: "Owner Events" });
    const intruder = await createOrganizer({
      organizationName: "Intruder Events",
    });
    const { event } = await createEvent(owner.organization!.id, {
      name: "Private Event",
    });

    // Act
    const response = await deleteEvent(
      event.id,
      signAccessToken(intruder.user),
    );

    // Assert
    expect(response.status).toBe(404);
    expect(response.body).toEqual({ message: "Event not found" });

    const savedEvent = await prisma.event.findUniqueOrThrow({
      where: { id: event.id },
    });
    expect(savedEvent.deletedAt).toBeNull();
  });

  it("should return 401 when no token is provided", async () => {
    // Arrange
    const { organization } = await createOrganizer();
    const { event } = await createEvent(organization!.id);

    // Act
    const response = await deleteEvent(event.id);

    // Assert
    expect(response.status).toBe(401);
    expect(response.body).toEqual({ message: "Token not provided" });

    const savedEvent = await prisma.event.findUniqueOrThrow({
      where: { id: event.id },
    });
    expect(savedEvent.deletedAt).toBeNull();
  });

  it("should return 401 for an invalid token", async () => {
    // Arrange
    const { organization } = await createOrganizer();
    const { event } = await createEvent(organization!.id);

    // Act
    const response = await deleteEvent(event.id, "not-a-real-token");

    // Assert
    expect(response.status).toBe(401);
    expect(response.body).toEqual({ message: "Invalid token" });

    const savedEvent = await prisma.event.findUniqueOrThrow({
      where: { id: event.id },
    });
    expect(savedEvent.deletedAt).toBeNull();
  });

  it("should return 403 when the authenticated user is a customer", async () => {
    // Arrange
    const { organization } = await createOrganizer();
    const customer = await createCustomer();
    const { event } = await createEvent(organization!.id);

    // Act
    const response = await deleteEvent(event.id, signAccessToken(customer));

    // Assert
    expect(response.status).toBe(403);
    expect(response.body).toEqual({
      message: "Only organizers can manage events",
    });

    const savedEvent = await prisma.event.findUniqueOrThrow({
      where: { id: event.id },
    });
    expect(savedEvent.deletedAt).toBeNull();
  });

  it("should return 404 when the organizer has no organization", async () => {
    // Arrange
    const { organization } = await createOrganizer();
    const { event } = await createEvent(organization!.id);
    const { user } = await createOrganizer({ withOrganization: false });

    // Act
    const response = await deleteEvent(event.id, signAccessToken(user));

    // Assert
    expect(response.status).toBe(404);
    expect(response.body).toEqual({ message: "Organization not found" });

    const savedEvent = await prisma.event.findUniqueOrThrow({
      where: { id: event.id },
    });
    expect(savedEvent.deletedAt).toBeNull();
  });
});
