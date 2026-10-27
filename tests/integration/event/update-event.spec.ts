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

async function createCategory(name = `Category ${Date.now()}-${sequence}`) {
  return prisma.category.create({ data: { name } });
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

function patchEvent(id: number | string, token?: string) {
  const req = request(app).patch(`/api/events/${id}`);

  if (token !== undefined) {
    req.set("Authorization", `Bearer ${token}`);
  }

  return req;
}

describe("PATCH /events/:id", () => {
  it("should update a single field and preserve the rest", async () => {
    // Arrange
    const { user, organization } = await createOrganizer({
      organizationName: "Acme Events",
      organizationLogo: "https://res.cloudinary.com/demo/image/upload/logo.png",
    });
    const { event, category } = await createEvent(organization!.id, {
      name: "Jakarta Music Fest",
      description: "A full-day music festival",
      city: "Bandung",
      image: "https://res.cloudinary.com/demo/image/upload/event.jpg",
      categoryName: "Music",
      tickets: [
        { name: "General Admission", price: 100_000, quantity: 100 },
        { name: "VIP", price: 250_000, quantity: 20, availableQuantity: 15 },
      ],
    });
    const originalTickets = event.tickets.map((ticket) => ({
      id: ticket.id,
      eventId: ticket.eventId,
      name: ticket.name,
      price: ticket.price,
      quantity: ticket.quantity,
      availableQuantity: ticket.availableQuantity,
    }));

    // Act
    const response = await patchEvent(
      event.id,
      signAccessToken(user),
    ).send({ name: "Updated Music Fest" });

    // Assert
    expect(response.status).toBe(200);
    expect(response.body.message).toBe("Event updated successfully");

    const { data } = response.body;
    expect(data).toMatchObject({
      id: event.id,
      categoryId: category.id,
      organizationId: organization!.id,
      name: "Updated Music Fest",
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
      id: organization!.id,
      name: "Acme Events",
      logo: "https://res.cloudinary.com/demo/image/upload/logo.png",
    });

    expect(data.tickets).toEqual(expect.arrayContaining(originalTickets));

    const savedEvent = await prisma.event.findUniqueOrThrow({
      where: { id: event.id },
    });
    expect(savedEvent.name).toBe("Updated Music Fest");
    expect(savedEvent.description).toBe("A full-day music festival");
    expect(savedEvent.city).toBe("Bandung");
  });

  it("should update multiple fields including the category", async () => {
    // Arrange
    const { user, organization } = await createOrganizer();
    const { event } = await createEvent(organization!.id, {
      name: "Original Event",
      categoryName: "Music",
    });
    const newCategory = await createCategory("Technology");
    const newStartDate = new Date(event.startDate.getTime() + 3 * DAY_IN_MS);
    const newEndDate = new Date(newStartDate.getTime() + 2 * DAY_IN_MS);

    // Act
    const response = await patchEvent(event.id, signAccessToken(user)).send({
      categoryId: newCategory.id,
      name: "Updated Event",
      description: "An updated description",
      city: "Surabaya",
      type: EventType.ONLINE,
      slug: "updated-event-slug",
      image: "https://res.cloudinary.com/demo/image/upload/updated.jpg",
      startDate: newStartDate,
      endDate: newEndDate,
    });

    // Assert
    expect(response.status).toBe(200);
    expect(response.body.message).toBe("Event updated successfully");

    const { data } = response.body;
    expect(data).toMatchObject({
      id: event.id,
      categoryId: newCategory.id,
      organizationId: organization!.id,
      name: "Updated Event",
      description: "An updated description",
      city: "Surabaya",
      type: EventType.ONLINE,
      slug: "updated-event-slug",
      image: "https://res.cloudinary.com/demo/image/upload/updated.jpg",
      startDate: newStartDate.toISOString(),
      endDate: newEndDate.toISOString(),
      deletedAt: null,
    });

    expect(data.category).toEqual({
      id: newCategory.id,
      name: "Technology",
      description: null,
    });

    const savedEvent = await prisma.event.findUniqueOrThrow({
      where: { id: event.id },
    });
    expect(savedEvent.categoryId).toBe(newCategory.id);
    expect(savedEvent.name).toBe("Updated Event");
    expect(savedEvent.type).toBe(EventType.ONLINE);
    expect(savedEvent.slug).toBe("updated-event-slug");
    expect(savedEvent.startDate.getTime()).toBe(newStartDate.getTime());
    expect(savedEvent.endDate.getTime()).toBe(newEndDate.getTime());
  });

  it("should update one date without changing the other date", async () => {
    // Arrange
    const { user, organization } = await createOrganizer();
    const { event } = await createEvent(organization!.id);

    // Act: update only the end date.
    const newEndDate = new Date(event.endDate.getTime() + 2 * DAY_IN_MS);
    const endDateResponse = await patchEvent(
      event.id,
      signAccessToken(user),
    ).send({ endDate: newEndDate });

    // Assert
    expect(endDateResponse.status).toBe(200);
    expect(endDateResponse.body.data.startDate).toBe(
      event.startDate.toISOString(),
    );
    expect(endDateResponse.body.data.endDate).toBe(newEndDate.toISOString());

    // Act: update only the start date, keeping it before the new end date.
    const newStartDate = new Date(event.startDate.getTime() + DAY_IN_MS);
    const startDateResponse = await patchEvent(
      event.id,
      signAccessToken(user),
    ).send({ startDate: newStartDate });

    // Assert
    expect(startDateResponse.status).toBe(200);
    expect(startDateResponse.body.data.startDate).toBe(
      newStartDate.toISOString(),
    );
    expect(startDateResponse.body.data.endDate).toBe(newEndDate.toISOString());
  });

  it("should not modify other events", async () => {
    // Arrange
    const { user, organization } = await createOrganizer();
    const otherOrganizer = await createOrganizer({
      organizationName: "Other Events",
    });
    const updated = await createEvent(organization!.id, { name: "First Event" });
    const untouched = await createEvent(organization!.id, {
      name: "Second Event",
    });
    const otherEvent = await createEvent(otherOrganizer.organization!.id, {
      name: "Other Organizer Event",
    });

    // Act
    const response = await patchEvent(
      updated.event.id,
      signAccessToken(user),
    ).send({ name: "First Event Updated" });

    // Assert
    expect(response.status).toBe(200);

    const savedUpdated = await prisma.event.findUniqueOrThrow({
      where: { id: updated.event.id },
    });
    const savedUntouched = await prisma.event.findUniqueOrThrow({
      where: { id: untouched.event.id },
    });
    const savedOther = await prisma.event.findUniqueOrThrow({
      where: { id: otherEvent.event.id },
    });

    expect(savedUpdated.name).toBe("First Event Updated");
    expect(savedUntouched.name).toBe("Second Event");
    expect(savedOther.name).toBe("Other Organizer Event");
  });

  it("should ignore attempts to change the organization or tickets", async () => {
    // Arrange
    const { user, organization } = await createOrganizer();
    const otherOrganizer = await createOrganizer({
      organizationName: "Other Events",
    });
    const { event } = await createEvent(organization!.id, {
      name: "Owned Event",
      tickets: [{ name: "General Admission", price: 100_000, quantity: 50 }],
    });

    // Act
    const response = await patchEvent(event.id, signAccessToken(user)).send({
      name: "Renamed Event",
      organizationId: otherOrganizer.organization!.id,
      tickets: [],
      deletedAt: new Date(),
    });

    // Assert
    expect(response.status).toBe(200);
    expect(response.body.data.organizationId).toBe(organization!.id);
    expect(response.body.data.deletedAt).toBeNull();
    expect(response.body.data.tickets).toHaveLength(1);

    const savedEvent = await prisma.event.findUniqueOrThrow({
      where: { id: event.id },
      include: { tickets: true },
    });
    expect(savedEvent.organizationId).toBe(organization!.id);
    expect(savedEvent.deletedAt).toBeNull();
    expect(savedEvent.tickets).toHaveLength(1);
  });

  it("should return 401 when no token is provided", async () => {
    // Arrange
    const { organization } = await createOrganizer();
    const { event } = await createEvent(organization!.id);

    // Act
    const response = await patchEvent(event.id).send({ name: "Hacked Event" });

    // Assert
    expect(response.status).toBe(401);
    expect(response.body).toEqual({ message: "Token not provided" });

    const savedEvent = await prisma.event.findUniqueOrThrow({
      where: { id: event.id },
    });
    expect(savedEvent.name).toBe(event.name);
  });

  it("should return 401 for an invalid token", async () => {
    // Arrange
    const { organization } = await createOrganizer();
    const { event } = await createEvent(organization!.id);

    // Act
    const response = await patchEvent(event.id, "not-a-real-token").send({
      name: "Hacked Event",
    });

    // Assert
    expect(response.status).toBe(401);
    expect(response.body).toEqual({ message: "Invalid token" });
  });

  it("should return 403 when the authenticated user is a customer", async () => {
    // Arrange
    const customer = await createCustomer();

    // Act
    const response = await patchEvent(1, signAccessToken(customer)).send({
      name: "Customer Event",
    });

    // Assert
    expect(response.status).toBe(403);
    expect(response.body).toEqual({
      message: "Only organizers can manage events",
    });
  });

  it("should return 404 when the organizer has no organization", async () => {
    // Arrange
    const { user } = await createOrganizer({ withOrganization: false });

    // Act
    const response = await patchEvent(1, signAccessToken(user)).send({
      name: "Updated Event",
    });

    // Assert
    expect(response.status).toBe(404);
    expect(response.body).toEqual({ message: "Organization not found" });
  });

  it("should return 404 when the event does not exist", async () => {
    // Arrange
    const { user } = await createOrganizer();

    // Act
    const response = await patchEvent(999999999, signAccessToken(user)).send({
      name: "Updated Event",
    });

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
    const response = await patchEvent(
      event.id,
      signAccessToken(intruder.user),
    ).send({ name: "Stolen Event" });

    // Assert
    expect(response.status).toBe(404);
    expect(response.body).toEqual({ message: "Event not found" });

    const savedEvent = await prisma.event.findUniqueOrThrow({
      where: { id: event.id },
    });
    expect(savedEvent.name).toBe("Private Event");
  });

  it("should return 404 when the event is soft-deleted", async () => {
    // Arrange
    const { user, organization } = await createOrganizer();
    const { event } = await createEvent(organization!.id, {
      name: "Deleted Event",
      deletedAt: new Date(),
    });

    // Act
    const response = await patchEvent(event.id, signAccessToken(user)).send({
      name: "Resurrected Event",
    });

    // Assert
    expect(response.status).toBe(404);
    expect(response.body).toEqual({ message: "Event not found" });

    const savedEvent = await prisma.event.findUniqueOrThrow({
      where: { id: event.id },
    });
    expect(savedEvent.name).toBe("Deleted Event");
    expect(savedEvent.deletedAt).not.toBeNull();
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
      // Arrange
      const { user } = await createOrganizer();

      // Act
      const response = await patchEvent(id, signAccessToken(user)).send({
        name: "Updated Event",
      });

      // Assert
      expect(response.status).toBe(400);
      expect(response.body).toEqual({ message: "Invalid event ID" });
    },
  );

  it("should return 400 when no fields are provided", async () => {
    // Arrange
    const { user, organization } = await createOrganizer();
    const { event } = await createEvent(organization!.id);

    // Act
    const response = await patchEvent(event.id, signAccessToken(user)).send(
      {},
    );

    // Assert
    expect(response.status).toBe(400);
    expect(response.body.message).toContain(
      "At least one field must be provided",
    );
  });

  it("should return 400 when the event name is too short", async () => {
    // Arrange
    const { user, organization } = await createOrganizer();
    const { event } = await createEvent(organization!.id);

    // Act
    const response = await patchEvent(event.id, signAccessToken(user)).send({
      name: "ab",
    });

    // Assert
    expect(response.status).toBe(400);
    expect(response.body.message).toBe(
      "name: Too small: expected string to have >=3 characters",
    );
  });

  it("should return 400 when the city is too short", async () => {
    // Arrange
    const { user, organization } = await createOrganizer();
    const { event } = await createEvent(organization!.id);

    // Act
    const response = await patchEvent(event.id, signAccessToken(user)).send({
      city: "J",
    });

    // Assert
    expect(response.status).toBe(400);
    expect(response.body.message).toBe(
      "city: Too small: expected string to have >=2 characters",
    );
  });

  it("should return 400 when the event type is invalid", async () => {
    // Arrange
    const { user, organization } = await createOrganizer();
    const { event } = await createEvent(organization!.id);

    // Act
    const response = await patchEvent(event.id, signAccessToken(user)).send({
      type: "HYBRID",
    });

    // Assert
    expect(response.status).toBe(400);
    expect(response.body.message).toBe(
      'type: Invalid option: expected one of "VENUE"|"ONLINE"',
    );
  });

  const invalidCategoryIds: Array<[string, unknown]> = [
    ["zero", 0],
    ["negative", -1],
    ["non-numeric", "abc"],
  ];

  it.each(invalidCategoryIds)(
    "should return 400 for a %s category id",
    async (_case, categoryId) => {
      // Arrange
      const { user, organization } = await createOrganizer();
      const { event } = await createEvent(organization!.id);

      // Act
      const response = await patchEvent(
        event.id,
        signAccessToken(user),
      ).send({ categoryId });

      // Assert
      expect(response.status).toBe(400);
      expect(response.body.message).toContain("categoryId:");
    },
  );

  it.each(["startDate", "endDate"])(
    "should return 400 when %s is not a valid date",
    async (field) => {
      // Arrange
      const { user, organization } = await createOrganizer();
      const { event } = await createEvent(organization!.id);

      // Act
      const response = await patchEvent(event.id, signAccessToken(user)).send({
        [field]: "not-a-date",
      });

      // Assert
      expect(response.status).toBe(400);
      expect(response.body.message).toContain(`${field}:`);
    },
  );

  it("should return 400 when both dates would create an invalid range", async () => {
    // Arrange
    const { user, organization } = await createOrganizer();
    const { event } = await createEvent(organization!.id);
    const startDate = new Date(event.startDate.getTime() + 5 * DAY_IN_MS);

    // Act
    const response = await patchEvent(event.id, signAccessToken(user)).send({
      startDate,
      endDate: new Date(startDate.getTime() - DAY_IN_MS),
    });

    // Assert
    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      message: "End date must be after start date",
    });

    const savedEvent = await prisma.event.findUniqueOrThrow({
      where: { id: event.id },
    });
    expect(savedEvent.startDate.getTime()).toBe(event.startDate.getTime());
    expect(savedEvent.endDate.getTime()).toBe(event.endDate.getTime());
  });

  it("should return 400 when a single date change would invert the range", async () => {
    // Arrange
    const { user, organization } = await createOrganizer();
    const movedEndDate = await createEvent(organization!.id);
    const movedStartDate = await createEvent(organization!.id);

    // Act: move the end date before the existing start date.
    const endDateResponse = await patchEvent(
      movedEndDate.event.id,
      signAccessToken(user),
    ).send({
      endDate: new Date(movedEndDate.event.startDate.getTime() - DAY_IN_MS),
    });

    // Act: move the start date after the existing end date.
    const startDateResponse = await patchEvent(
      movedStartDate.event.id,
      signAccessToken(user),
    ).send({
      startDate: new Date(movedStartDate.event.endDate.getTime() + DAY_IN_MS),
    });

    // Assert
    expect(endDateResponse.status).toBe(400);
    expect(endDateResponse.body).toEqual({
      message: "End date must be after start date",
    });
    expect(startDateResponse.status).toBe(400);
    expect(startDateResponse.body).toEqual({
      message: "End date must be after start date",
    });

    const savedEndDateEvent = await prisma.event.findUniqueOrThrow({
      where: { id: movedEndDate.event.id },
    });
    const savedStartDateEvent = await prisma.event.findUniqueOrThrow({
      where: { id: movedStartDate.event.id },
    });
    expect(savedEndDateEvent.endDate.getTime()).toBe(
      movedEndDate.event.endDate.getTime(),
    );
    expect(savedStartDateEvent.startDate.getTime()).toBe(
      movedStartDate.event.startDate.getTime(),
    );
  });

  it("should not expose organizer credentials or private organization fields", async () => {
    // Arrange
    const { user, organization } = await createOrganizer();
    const { event } = await createEvent(organization!.id);

    // Act
    const response = await patchEvent(event.id, signAccessToken(user)).send({
      name: "Renamed Event",
    });

    // Assert
    expect(response.status).toBe(200);
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
});
