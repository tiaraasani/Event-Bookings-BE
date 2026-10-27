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

describe("GET /events", () => {
  it("should return active events with their category, organization and tickets", async () => {
    // Arrange
    const { event, category, organization } = await createEvent({
      name: "Jakarta Music Fest",
      description: "A full-day music festival",
      city: "Jakarta",
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
    const response = await request(app).get("/api/events");

    // Assert
    expect(response.status).toBe(200);
    expect(response.body.message).toBe("Events retrieved successfully");
    expect(response.body.data).toHaveLength(1);

    const [returnedEvent] = response.body.data;
    expect(returnedEvent).toMatchObject({
      id: event.id,
      categoryId: category.id,
      organizationId: organization.id,
      name: "Jakarta Music Fest",
      description: "A full-day music festival",
      city: "Jakarta",
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
      id: organization.id,
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

  it("should exclude soft-deleted events", async () => {
    // Arrange
    const active = await createEvent({ name: "Active Event" });
    await createEvent({
      name: "Deleted Event",
      deletedAt: new Date(),
    });

    // Act
    const response = await request(app).get("/api/events");

    // Assert
    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0].id).toBe(active.event.id);
    expect(response.body.data[0].name).toBe("Active Event");
  });

  it("should order events by start date ascending", async () => {
    // Arrange
    const late = await createEvent({
      name: "Late Event",
      startDate: new Date("2027-01-15T10:00:00.000Z"),
    });
    const early = await createEvent({
      name: "Early Event",
      startDate: new Date("2026-11-01T10:00:00.000Z"),
    });
    const middle = await createEvent({
      name: "Middle Event",
      startDate: new Date("2026-12-01T10:00:00.000Z"),
    });

    // Act
    const response = await request(app).get("/api/events");

    // Assert
    expect(response.status).toBe(200);
    expect(response.body.data.map((event: { id: number }) => event.id)).toEqual(
      [early.event.id, middle.event.id, late.event.id],
    );
  });

  it("should return an empty list when there are no events", async () => {
    // Act
    const response = await request(app).get("/api/events");

    // Assert
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      message: "Events retrieved successfully",
      data: [],
    });
  });

  it("should be publicly accessible without a token", async () => {
    // Arrange
    await createEvent({ name: "Public Event" });

    // Act
    const response = await request(app)
      .get("/api/events")
      .set("Authorization", "Bearer not-a-real-token");

    // Assert
    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0].name).toBe("Public Event");
  });

  it("should not expose organizer credentials or private organization fields", async () => {
    // Arrange
    const { organization } = await createEvent();

    // Act
    const response = await request(app).get("/api/events");

    // Assert
    expect(response.status).toBe(200);

    const [returnedEvent] = response.body.data;
    expect(Object.keys(returnedEvent.organization).sort()).toEqual([
      "id",
      "logo",
      "name",
    ]);
    expect(returnedEvent.organization.id).toBe(organization.id);
    expect(returnedEvent.organization).not.toHaveProperty("userId");
    expect(returnedEvent.organization).not.toHaveProperty("description");
    expect(returnedEvent.organization).not.toHaveProperty("field");
    expect(JSON.stringify(response.body)).not.toContain("password");
  });
});
