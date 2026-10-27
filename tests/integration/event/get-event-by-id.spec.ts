import argon from "argon2";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { EventType, Role } from "../../../src/generated/prisma/enums.js";
import { prisma } from "../../../src/lib/prisma.js";
import { app } from "../../../src/app.js";

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
  organizationName?: string;
  organizationLogo?: string | null;
  tickets?: TestTicketOverrides[];
};

let sequence = 0;

async function createEvent(overrides: TestEventOverrides = {}) {
  sequence += 1;

  const organization = await prisma.organization.create({
    data: {
      name: overrides.organizationName ?? "Acme Events",
      logo: overrides.organizationLogo ?? null,
      user: {
        create: {
          name: "Event Organizer",
          email: `organizer-${Date.now()}-${sequence}@mail.com`,
          password: await argon.hash("Test123!"),
          role: Role.ORGANIZER,
          referralCode: `ORGANIZER${Date.now()}${sequence}`,
        },
      },
    },
  });

  const category = await prisma.category.create({
    data: {
      name: overrides.categoryName ?? `Category ${Date.now()}-${sequence}`,
    },
  });

  const startDate =
    overrides.startDate ?? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const endDate =
    overrides.endDate ?? new Date(startDate.getTime() + 24 * 60 * 60 * 1000);

  const tickets = overrides.tickets ?? [
    { name: "General Admission", price: 100_000, quantity: 100 },
  ];

  const event = await prisma.event.create({
    data: {
      categoryId: category.id,
      organizationId: organization.id,
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
      organization: true,
      tickets: true,
    },
  });

  return { event, category, organization };
}

describe("GET /events/:id", () => {
  it("should return the event with its category, organization and tickets", async () => {
    // Arrange
    const { event, category, organization } = await createEvent({
      name: "Jakarta Music Fest",
      description: "A full-day music festival",
      city: "Bandung",
      type: EventType.VENUE,
      image: "https://res.cloudinary.com/demo/image/upload/event.jpg",
      categoryName: "Music",
      organizationName: "Acme Events",
      organizationLogo: "https://res.cloudinary.com/demo/image/upload/logo.png",
      tickets: [
        { name: "General Admission", price: 100_000, quantity: 100 },
        { name: "VIP", price: 250_000, quantity: 20, availableQuantity: 15 },
      ],
    });

    // Act
    const response = await request(app).get(`/api/events/${event.id}`);

    // Assert
    expect(response.status).toBe(200);
    expect(response.body.message).toBe("Event retrieved successfully");

    const { data } = response.body;
    expect(data).toMatchObject({
      id: event.id,
      categoryId: category.id,
      organizationId: organization.id,
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

    expect(data.category).toEqual({
      id: category.id,
      name: "Music",
      description: null,
    });

    expect(data.organization).toEqual({
      id: organization.id,
      name: "Acme Events",
      logo: "https://res.cloudinary.com/demo/image/upload/logo.png",
    });

    expect(data.tickets).toHaveLength(2);
    expect(data.tickets).toEqual(
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

  it("should return only the requested event", async () => {
    // Arrange
    const requested = await createEvent({ name: "Requested Event" });
    await createEvent({ name: "Other Event" });

    // Act
    const response = await request(app).get(
      `/api/events/${requested.event.id}`,
    );

    // Assert
    expect(response.status).toBe(200);
    expect(response.body.data.id).toBe(requested.event.id);
    expect(response.body.data.name).toBe("Requested Event");
  });

  it("should return 404 when the event is soft-deleted", async () => {
    // Arrange
    const { event } = await createEvent({
      name: "Deleted Event",
      deletedAt: new Date(),
    });

    // Act
    const response = await request(app).get(`/api/events/${event.id}`);

    // Assert
    expect(response.status).toBe(404);
    expect(response.body).toEqual({ message: "Event not found" });
  });

  it("should return 404 when the event does not exist", async () => {
    // Act
    const response = await request(app).get("/api/events/999999999");

    // Assert
    expect(response.status).toBe(404);
    expect(response.body).toEqual({ message: "Event not found" });
  });

  it("should be publicly accessible without a valid token", async () => {
    // Arrange
    const { event } = await createEvent({ name: "Public Event" });

    // Act
    const response = await request(app)
      .get(`/api/events/${event.id}`)
      .set("Authorization", "Bearer not-a-real-token");

    // Assert
    expect(response.status).toBe(200);
    expect(response.body.data.id).toBe(event.id);
    expect(response.body.data.name).toBe("Public Event");
  });

  it("should not expose organizer credentials or private organization fields", async () => {
    // Arrange
    const { event } = await createEvent();

    // Act
    const response = await request(app).get(`/api/events/${event.id}`);

    // Assert
    expect(response.status).toBe(200);

    const { data } = response.body;
    expect(Object.keys(data.organization).sort()).toEqual([
      "id",
      "logo",
      "name",
    ]);
    expect(data.organization).not.toHaveProperty("userId");
    expect(data.organization).not.toHaveProperty("description");
    expect(data.organization).not.toHaveProperty("field");
    expect(JSON.stringify(response.body)).not.toContain("password");
  });

  const invalidEventIds: Array<[string, string]> = [
    ["non-numeric", "not-a-number"],
    ["decimal", "1.5"],
    ["zero", "0"],
    ["negative", "-1"],
    ["mixed alphanumeric", "12abc"],
  ];

  it.each(invalidEventIds)(
    "should return 400 for a %s event id",
    async (_case, id) => {
      // Act
      const response = await request(app).get(`/api/events/${id}`);

      // Assert
      expect(response.status).toBe(400);
      expect(response.body).toEqual({ message: "Invalid event ID" });
    },
  );
});
