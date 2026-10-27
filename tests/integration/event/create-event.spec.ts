import argon from "argon2";
import jwt from "jsonwebtoken";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { EventType, Role } from "../../../src/generated/prisma/enums.js";
import { prisma } from "../../../src/lib/prisma.js";
import { app } from "../../../src/app.js";

const DAY_IN_MS = 24 * 60 * 60 * 1000;

type TestTicketPayload = {
  name: string;
  price: number;
  quantity: number;
  availableQuantity?: number;
};

type TestEventPayloadOverrides = {
  categoryId?: number;
  customCategory?: string;
  name?: string;
  description?: string;
  city?: string;
  type?: EventType;
  slug?: string;
  image?: string;
  startDate?: Date;
  endDate?: Date;
  tickets?: TestTicketPayload[];
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

async function createCategory(name = `Category ${Date.now()}-${sequence}`) {
  return prisma.category.create({ data: { name } });
}

function signAccessToken(user: { id: number; role: Role }) {
  return jwt.sign({ id: user.id, role: user.role }, process.env.JWT_SECRET!, {
    expiresIn: "1h",
  });
}

function buildEventPayload(overrides: TestEventPayloadOverrides = {}) {
  sequence += 1;

  const startDate =
    overrides.startDate ?? new Date(Date.now() + 7 * DAY_IN_MS);
  const endDate =
    overrides.endDate ?? new Date(startDate.getTime() + DAY_IN_MS);

  return {
    ...(overrides.categoryId !== undefined && {
      categoryId: overrides.categoryId,
    }),
    ...(overrides.customCategory !== undefined && {
      customCategory: overrides.customCategory,
    }),
    name: overrides.name ?? "Jakarta Music Fest",
    description: overrides.description ?? "A full-day music festival",
    city: overrides.city ?? "Jakarta",
    type: overrides.type ?? EventType.VENUE,
    slug: overrides.slug ?? `jakarta-music-fest-${Date.now()}-${sequence}`,
    ...(overrides.image !== undefined && { image: overrides.image }),
    startDate,
    endDate,
    tickets: overrides.tickets ?? [
      { name: "General Admission", price: 100_000, quantity: 100 },
    ],
  };
}

function postEvent(token?: string) {
  const req = request(app).post("/api/events");

  if (token !== undefined) {
    req.set("Authorization", `Bearer ${token}`);
  }

  return req;
}

describe("POST /events", () => {
  it("should create an event with its tickets", async () => {
    // Arrange
    const { user, organization } = await createOrganizer({
      organizationName: "Acme Events",
      organizationLogo: "https://res.cloudinary.com/demo/image/upload/logo.png",
    });
    const category = await createCategory("Music");
    const payload = buildEventPayload({
      categoryId: category.id,
      name: "Jakarta Music Fest",
      description: "A full-day music festival",
      city: "Bandung",
      type: EventType.VENUE,
      image: "https://res.cloudinary.com/demo/image/upload/event.jpg",
      tickets: [
        { name: "General Admission", price: 100_000, quantity: 100 },
        { name: "VIP", price: 250_000, quantity: 20 },
      ],
    });

    // Act
    const response = await postEvent(signAccessToken(user)).send(payload);

    // Assert
    expect(response.status).toBe(201);
    expect(response.body.message).toBe("Event created successfully");

    const { data } = response.body;
    expect(data).toMatchObject({
      id: expect.any(Number),
      categoryId: category.id,
      organizationId: organization!.id,
      name: "Jakarta Music Fest",
      description: "A full-day music festival",
      city: "Bandung",
      type: EventType.VENUE,
      slug: payload.slug,
      image: "https://res.cloudinary.com/demo/image/upload/event.jpg",
      startDate: payload.startDate.toISOString(),
      endDate: payload.endDate.toISOString(),
      deletedAt: null,
    });

    expect(data.category).toEqual({
      id: category.id,
      name: "Music",
      description: null,
    });

    expect(data.organization).toEqual({
      id: organization!.id,
      name: "Acme Events",
      logo: "https://res.cloudinary.com/demo/image/upload/logo.png",
    });

    expect(data.tickets).toHaveLength(2);
    expect(data.tickets).toEqual(
      expect.arrayContaining([
        {
          id: expect.any(Number),
          eventId: data.id,
          name: "General Admission",
          price: 100_000,
          quantity: 100,
          availableQuantity: 100,
        },
        {
          id: expect.any(Number),
          eventId: data.id,
          name: "VIP",
          price: 250_000,
          quantity: 20,
          availableQuantity: 20,
        },
      ]),
    );

    const savedEvent = await prisma.event.findUniqueOrThrow({
      where: { id: data.id },
      include: { tickets: true },
    });
    expect(savedEvent.organizationId).toBe(organization!.id);
    expect(savedEvent.tickets).toHaveLength(2);
  });

  it("should create the event for the authenticated organizer's organization", async () => {
    // Arrange
    const organizer = await createOrganizer({ organizationName: "My Events" });
    const otherOrganizer = await createOrganizer({
      organizationName: "Other Events",
    });
    const category = await createCategory();

    const payload = {
      ...buildEventPayload({ categoryId: category.id }),
      organizationId: otherOrganizer.organization!.id,
    };

    // Act
    const response = await postEvent(signAccessToken(organizer.user)).send(
      payload,
    );

    // Assert
    expect(response.status).toBe(201);
    expect(response.body.data.organizationId).toBe(organizer.organization!.id);
    expect(response.body.data.organization.name).toBe("My Events");
  });

  it("should create a new category from customCategory", async () => {
    // Arrange
    const { user } = await createOrganizer();
    const payload = buildEventPayload({
      customCategory: "  Technology  ",
    });

    // Act
    const response = await postEvent(signAccessToken(user)).send(payload);

    // Assert
    expect(response.status).toBe(201);

    const { data } = response.body;
    expect(data.category.name).toBe("Technology");

    const category = await prisma.category.findUniqueOrThrow({
      where: { id: data.categoryId },
    });
    expect(category.name).toBe("Technology");
  });

  it("should reuse an existing category when customCategory matches", async () => {
    // Arrange
    const { user } = await createOrganizer();
    const existingCategory = await createCategory("Music");
    const payload = buildEventPayload({ customCategory: "Music" });

    // Act
    const response = await postEvent(signAccessToken(user)).send(payload);

    // Assert
    expect(response.status).toBe(201);
    expect(response.body.data.categoryId).toBe(existingCategory.id);
    expect(await prisma.category.count({ where: { name: "Music" } })).toBe(1);
  });

  it("should accept a multipart/form-data payload", async () => {
    // Arrange
    const { user } = await createOrganizer();
    const category = await createCategory();
    const payload = buildEventPayload({
      categoryId: category.id,
      name: "Form Data Event",
    });

    // Act
    const response = await postEvent(signAccessToken(user)).field(
      "data",
      JSON.stringify(payload),
    );

    // Assert
    expect(response.status).toBe(201);
    expect(response.body.data.name).toBe("Form Data Event");
  });

  it("should accept an ONLINE event without an image", async () => {
    // Arrange
    const { user } = await createOrganizer();
    const category = await createCategory();
    const payload = buildEventPayload({
      categoryId: category.id,
      type: EventType.ONLINE,
    });

    // Act
    const response = await postEvent(signAccessToken(user)).send(payload);

    // Assert
    expect(response.status).toBe(201);
    expect(response.body.data.type).toBe(EventType.ONLINE);
    expect(response.body.data.image).toBeNull();
  });

  it("should set availableQuantity equal to the requested quantity", async () => {
    // Arrange
    const { user } = await createOrganizer();
    const category = await createCategory();
    const payload = buildEventPayload({
      categoryId: category.id,
      tickets: [
        {
          name: "Early Bird",
          price: 50_000,
          quantity: 30,
          availableQuantity: 0,
        },
      ],
    });

    // Act
    const response = await postEvent(signAccessToken(user)).send(payload);

    // Assert
    expect(response.status).toBe(201);
    expect(response.body.data.tickets[0].quantity).toBe(30);
    expect(response.body.data.tickets[0].availableQuantity).toBe(30);
  });

  it("should not expose organizer credentials or private organization fields", async () => {
    // Arrange
    const { user } = await createOrganizer();
    const category = await createCategory();

    // Act
    const response = await postEvent(signAccessToken(user)).send(
      buildEventPayload({ categoryId: category.id }),
    );

    // Assert
    expect(response.status).toBe(201);
    expect(Object.keys(response.body.data.organization).sort()).toEqual([
      "id",
      "logo",
      "name",
    ]);
    expect(response.body.data.organization).not.toHaveProperty("userId");
    expect(response.body.data.organization).not.toHaveProperty("description");
    expect(response.body.data.organization).not.toHaveProperty("field");
    expect(JSON.stringify(response.body)).not.toContain("password");
  });

  it("should return 401 when no token is provided", async () => {
    // Act
    const response = await postEvent().send(buildEventPayload());

    // Assert
    expect(response.status).toBe(401);
    expect(response.body).toEqual({ message: "Token not provided" });
  });

  it("should return 401 for an invalid token", async () => {
    // Act
    const response = await postEvent("not-a-real-token").send(
      buildEventPayload(),
    );

    // Assert
    expect(response.status).toBe(401);
    expect(response.body).toEqual({ message: "Invalid token" });
  });

  it("should return 403 when the authenticated user is a customer", async () => {
    // Arrange
    const customer = await createCustomer();

    // Act
    const response = await postEvent(signAccessToken(customer)).send(
      buildEventPayload(),
    );

    // Assert
    expect(response.status).toBe(403);
    expect(response.body).toEqual({
      message: "Only organizers can manage events",
    });
  });

  it("should return 404 when the organizer has no organization", async () => {
    // Arrange
    const { user } = await createOrganizer({ withOrganization: false });
    const category = await createCategory();

    // Act
    const response = await postEvent(signAccessToken(user)).send(
      buildEventPayload({ categoryId: category.id }),
    );

    // Assert
    expect(response.status).toBe(404);
    expect(response.body).toEqual({ message: "Organization not found" });
  });

  it("should return 400 when no category is provided", async () => {
    // Arrange
    const { user } = await createOrganizer();

    // Act
    const response = await postEvent(signAccessToken(user)).send(
      buildEventPayload(),
    );

    // Assert
    expect(response.status).toBe(400);
    expect(response.body.message).toBe(
      "categoryId: Please select or enter a category",
    );
  });

  it("should return 400 when the end date is not after the start date", async () => {
    // Arrange
    const { user } = await createOrganizer();
    const category = await createCategory();
    const startDate = new Date(Date.now() + 7 * DAY_IN_MS);

    // Act
    const response = await postEvent(signAccessToken(user)).send(
      buildEventPayload({
        categoryId: category.id,
        startDate,
        endDate: new Date(startDate.getTime() - DAY_IN_MS),
      }),
    );

    // Assert
    expect(response.status).toBe(400);
    expect(response.body.message).toBe(
      "endDate: End date must be after start date",
    );
  });

  it("should return 400 when required fields are missing", async () => {
    // Arrange
    const { user } = await createOrganizer();

    // Act
    const response = await postEvent(signAccessToken(user)).send({});

    // Assert
    expect(response.status).toBe(400);

    for (const field of [
      "name",
      "city",
      "type",
      "slug",
      "startDate",
      "endDate",
      "tickets",
    ]) {
      expect(response.body.message).toContain(`${field}:`);
    }
  });

  const invalidTickets: Array<[string, TestTicketPayload[], string]> = [
    ["an empty list", [], "tickets:"],
    [
      "a negative price",
      [{ name: "Free", price: -1, quantity: 10 }],
      "tickets.0.price:",
    ],
    [
      "a zero quantity",
      [{ name: "Free", price: 0, quantity: 0 }],
      "tickets.0.quantity:",
    ],
  ];

  it.each(invalidTickets)(
    "should return 400 for %s",
    async (_case, tickets, expectedMessage) => {
      // Arrange
      const { user } = await createOrganizer();
      const category = await createCategory();

      // Act
      const response = await postEvent(signAccessToken(user)).send(
        buildEventPayload({ categoryId: category.id, tickets }),
      );

      // Assert
      expect(response.status).toBe(400);
      expect(response.body.message).toContain(expectedMessage);
    },
  );

  it("should return 400 when the event name is too short", async () => {
    // Arrange
    const { user } = await createOrganizer();
    const category = await createCategory();

    // Act
    const response = await postEvent(signAccessToken(user)).send(
      buildEventPayload({ categoryId: category.id, name: "ab" }),
    );

    // Assert
    expect(response.status).toBe(400);
    expect(response.body.message).toBe(
      "name: Too small: expected string to have >=3 characters",
    );
  });
});
