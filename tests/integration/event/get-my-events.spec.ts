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
  withOrganization?: boolean;
};

let sequence = 0;

async function createUser(overrides: TestUserOverrides = {}) {
  sequence += 1;

  return prisma.user.create({
    data: {
      name: overrides.name ?? "Test User",
      email: overrides.email ?? `user-${Date.now()}-${sequence}@mail.com`,
      password: await argon.hash("Test123!"),
      role: overrides.role ?? Role.CUSTOMER,
      referralCode: `USER${Date.now()}${sequence}`,
    },
  });
}

async function createOrganizer(overrides: TestOrganizerOverrides = {}) {
  const user = await createUser({
    name: overrides.name ?? "Event Organizer",
    email: overrides.email ?? `organizer-${Date.now()}-${sequence}@mail.com`,
    role: Role.ORGANIZER,
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

function signAccessToken(
  user: { id: number; role: Role },
  options: jwt.SignOptions = {},
) {
  return jwt.sign({ id: user.id, role: user.role }, process.env.JWT_SECRET!, {
    expiresIn: "1h",
    ...options,
  });
}

function getMyEvents(token?: string) {
  const req = request(app).get("/api/events/my");

  if (token !== undefined) {
    req.set("Authorization", `Bearer ${token}`);
  }

  return req;
}

describe("GET /events/my", () => {
  it("should return the organizer's events with their category, organization and tickets", async () => {
    // Arrange
    const { user, organization } = await createOrganizer({
      organizationName: "Acme Events",
      organizationLogo: "https://res.cloudinary.com/demo/image/upload/logo.png",
    });

    const { event, category } = await createEvent(organization!.id, {
      name: "Jakarta Music Fest",
      description: "A full-day music festival",
      city: "Bandung",
      type: EventType.VENUE,
      image: "https://res.cloudinary.com/demo/image/upload/event.jpg",
      categoryName: "Music",
      tickets: [
        { name: "General Admission", price: 100_000, quantity: 100 },
        { name: "VIP", price: 250_000, quantity: 20, availableQuantity: 15 },
      ],
    });

    // Act
    const response = await getMyEvents(signAccessToken(user));

    // Assert
    expect(response.status).toBe(200);
    expect(response.body.message).toBe(
      "Organized events retrieved successfully",
    );
    expect(response.body.data).toHaveLength(1);

    const [returnedEvent] = response.body.data;
    expect(returnedEvent).toMatchObject({
      id: event.id,
      categoryId: category.id,
      organizationId: organization!.id,
      name: "Jakarta Music Fest",
      description: "A full-day music festival",
      city: "Bandung",
      type: EventType.VENUE,
      slug: event.slug,
      image: "https://res.cloudinary.com/demo/image/upload/event.jpg",
      startDate: event.startDate.toISOString(),
      endDate: event.endDate.toISOString(),
      deletedAt: null,
    });

    expect(returnedEvent.category).toEqual({
      id: category.id,
      name: "Music",
      description: null,
    });

    expect(returnedEvent.organization).toEqual({
      id: organization!.id,
      name: "Acme Events",
      logo: "https://res.cloudinary.com/demo/image/upload/logo.png",
    });

    expect(returnedEvent.tickets).toHaveLength(2);
    expect(returnedEvent.tickets).toEqual(
      expect.arrayContaining([
        {
          id: expect.any(Number),
          eventId: event.id,
          name: "General Admission",
          price: 100_000,
          quantity: 100,
          availableQuantity: 100,
        },
        {
          id: expect.any(Number),
          eventId: event.id,
          name: "VIP",
          price: 250_000,
          quantity: 20,
          availableQuantity: 15,
        },
      ]),
    );
  });

  it("should only return events that belong to the authenticated organizer", async () => {
    // Arrange
    const organizer = await createOrganizer({ organizationName: "My Events" });
    const otherOrganizer = await createOrganizer({
      organizationName: "Other Events",
    });

    const ownEvent = await createEvent(organizer.organization!.id, {
      name: "My Event",
    });
    await createEvent(otherOrganizer.organization!.id, {
      name: "Other Organizer Event",
    });

    // Act
    const response = await getMyEvents(signAccessToken(organizer.user));

    // Assert
    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0].id).toBe(ownEvent.event.id);
    expect(response.body.data[0].name).toBe("My Event");
  });

  it("should exclude soft-deleted events", async () => {
    // Arrange
    const { user, organization } = await createOrganizer();

    const active = await createEvent(organization!.id, {
      name: "Active Event",
    });
    await createEvent(organization!.id, {
      name: "Deleted Event",
      deletedAt: new Date(),
    });

    // Act
    const response = await getMyEvents(signAccessToken(user));

    // Assert
    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0].id).toBe(active.event.id);
    expect(response.body.data[0].name).toBe("Active Event");
  });

  it("should order events by start date ascending", async () => {
    // Arrange
    const { user, organization } = await createOrganizer();

    const late = await createEvent(organization!.id, {
      name: "Late Event",
      startDate: new Date("2027-01-15T10:00:00.000Z"),
    });
    const early = await createEvent(organization!.id, {
      name: "Early Event",
      startDate: new Date("2026-11-01T10:00:00.000Z"),
    });
    const middle = await createEvent(organization!.id, {
      name: "Middle Event",
      startDate: new Date("2026-12-01T10:00:00.000Z"),
    });

    // Act
    const response = await getMyEvents(signAccessToken(user));

    // Assert
    expect(response.status).toBe(200);
    expect(response.body.data.map((event: { id: number }) => event.id)).toEqual(
      [early.event.id, middle.event.id, late.event.id],
    );
  });

  it("should return an empty list when the organizer has no events", async () => {
    // Arrange
    const { user } = await createOrganizer();

    // Act
    const response = await getMyEvents(signAccessToken(user));

    // Assert
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      message: "Organized events retrieved successfully",
      data: [],
    });
  });

  it("should return an empty list when the organizer has no organization", async () => {
    // Arrange
    const { user } = await createOrganizer({ withOrganization: false });

    // Act
    const response = await getMyEvents(signAccessToken(user));

    // Assert
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      message: "Organized events retrieved successfully",
      data: [],
    });
  });

  it("should return 401 when no token is provided", async () => {
    // Act
    const response = await getMyEvents();

    // Assert
    expect(response.status).toBe(401);
    expect(response.body).toEqual({ message: "Token not provided" });
  });

  it("should return 401 when the authorization header lacks the Bearer scheme", async () => {
    // Arrange
    const { user } = await createOrganizer();

    // Act
    const response = await request(app)
      .get("/api/events/my")
      .set("Authorization", signAccessToken(user));

    // Assert
    expect(response.status).toBe(401);
    expect(response.body).toEqual({ message: "Token not provided" });
  });

  it("should return 401 for an invalid token", async () => {
    // Act
    const response = await getMyEvents("not-a-real-token");

    // Assert
    expect(response.status).toBe(401);
    expect(response.body).toEqual({ message: "Invalid token" });
  });

  it("should return 401 for an expired token", async () => {
    // Arrange
    const { user } = await createOrganizer();
    const token = signAccessToken(user, { expiresIn: -10 });

    // Act
    const response = await getMyEvents(token);

    // Assert
    expect(response.status).toBe(401);
    expect(response.body).toEqual({ message: "Token expired" });
  });

  it("should return 403 when the authenticated user is a customer", async () => {
    // Arrange
    const customer = await createUser({ role: Role.CUSTOMER });

    // Act
    const response = await getMyEvents(signAccessToken(customer));

    // Assert
    expect(response.status).toBe(403);
    expect(response.body).toEqual({
      message: "Only organizers can manage events",
    });
  });

  it("should work with a token obtained from the login endpoint", async () => {
    // Arrange
    const { user, organization } = await createOrganizer();
    const { event } = await createEvent(organization!.id, {
      name: "Login Session Event",
    });

    const loginResponse = await request(app).post("/api/auth/login").send({
      email: user.email,
      password: "Test123!",
    });

    // Act
    const response = await getMyEvents(loginResponse.body.accessToken);

    // Assert
    expect(loginResponse.status).toBe(200);
    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0].id).toBe(event.id);
  });

  it("should not expose organizer credentials or private organization fields", async () => {
    // Arrange
    const { user, organization } = await createOrganizer();
    await createEvent(organization!.id);

    // Act
    const response = await getMyEvents(signAccessToken(user));

    // Assert
    expect(response.status).toBe(200);

    const [returnedEvent] = response.body.data;
    expect(Object.keys(returnedEvent.organization).sort()).toEqual([
      "id",
      "logo",
      "name",
    ]);
    expect(returnedEvent.organization).not.toHaveProperty("userId");
    expect(returnedEvent.organization).not.toHaveProperty("description");
    expect(returnedEvent.organization).not.toHaveProperty("field");
    expect(JSON.stringify(response.body)).not.toContain("password");
  });
});
