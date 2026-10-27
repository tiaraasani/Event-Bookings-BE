import request from "supertest";
import { describe, expect, it } from "vitest";
import {
  PaymentStatus,
  ReviewType,
} from "../../../src/generated/prisma/enums.js";
import { prisma } from "../../../src/lib/prisma.js";
import { app } from "../../../src/app.js";
import {
  DAY_IN_MS,
  TEST_PASSWORD,
  createCustomer,
  createEndedEvent,
  createEvent,
  createOrder,
  createOrganizer,
  createPaidOrder,
  createReview,
  signAccessToken,
  signExpiredToken,
} from "../../helpers/factories.js";

const REVIEW_SUBMITTED_MESSAGE = "Review submitted successfully";
const EVENT_NOT_FOUND_MESSAGE = "Event not found";
const EVENT_NOT_ENDED_MESSAGE =
  "You can only review an event after it has ended";
const NOT_ATTENDED_MESSAGE =
  "You must purchase and pay for a ticket to review this event";
const ALREADY_REVIEWED_MESSAGE =
  "You have already submitted this type of review for this order";

function buildReviewPayload(
  eventId: number | string,
  overrides: Record<string, unknown> = {},
) {
  return {
    eventId,
    type: ReviewType.EVENT,
    rating: 5,
    title: "Great event",
    comment: "Everything was well organized and fun.",
    ...overrides,
  };
}

function postReview(token?: string) {
  const req = request(app).post("/api/reviews");

  if (token !== undefined) {
    req.set("Authorization", `Bearer ${token}`);
  }

  return req;
}

/** A customer who paid for a ticket to an event that has already ended. */
async function createAttendedEvent() {
  const customer = await createCustomer();
  const { organization } = await createOrganizer();
  const { event, ticket } = await createEndedEvent(organization.id);
  const order = await createPaidOrder(customer.id, ticket.id);

  return { customer, organization, event, ticket, order };
}

describe("POST /reviews", () => {
  it("should create an event review for a paid order after the event ended", async () => {
    // Arrange
    const { customer, event, order } = await createAttendedEvent();
    const requestedAt = Date.now();

    // Act
    const response = await postReview(signAccessToken(customer)).send(
      buildReviewPayload(event.id),
    );

    // Assert
    expect(response.status).toBe(201);
    expect(response.body.message).toBe(REVIEW_SUBMITTED_MESSAGE);

    // The response must contain the review and nothing else (no order or user data).
    expect(response.body.data).toEqual({
      id: expect.any(Number),
      orderId: order.id,
      type: ReviewType.EVENT,
      rating: 5,
      title: "Great event",
      comment: "Everything was well organized and fun.",
      createdAt: expect.any(String),
    });

    const { data } = response.body;
    const createdAt = new Date(data.createdAt).getTime();
    expect(createdAt).toBeGreaterThanOrEqual(requestedAt - 5_000);
    expect(createdAt).toBeLessThanOrEqual(Date.now() + 5_000);

    const savedReview = await prisma.review.findUniqueOrThrow({
      where: { id: data.id },
    });
    expect(savedReview).toMatchObject({
      orderId: order.id,
      type: ReviewType.EVENT,
      rating: 5,
      title: "Great event",
      comment: "Everything was well organized and fun.",
    });
    expect(savedReview.createdAt.toISOString()).toBe(data.createdAt);
    expect(await prisma.review.count()).toBe(1);
  });

  it("should create an organizer review for a paid order", async () => {
    // Arrange
    const { customer, event, order } = await createAttendedEvent();

    // Act
    const response = await postReview(signAccessToken(customer)).send(
      buildReviewPayload(event.id, {
        type: ReviewType.ORGANIZER,
        rating: 4,
        title: "Responsive organizer",
        comment: "They answered every question before the show.",
      }),
    );

    // Assert
    expect(response.status).toBe(201);
    expect(response.body.data).toMatchObject({
      orderId: order.id,
      type: ReviewType.ORGANIZER,
      rating: 4,
      title: "Responsive organizer",
      comment: "They answered every question before the show.",
    });
    expect(await prisma.review.count({ where: { orderId: order.id } })).toBe(1);
  });

  it("should allow an organizer review on the same order as an event review", async () => {
    // Arrange
    const { customer, event, order } = await createAttendedEvent();
    await createReview(order.id, { type: ReviewType.EVENT });

    // Act
    const response = await postReview(signAccessToken(customer)).send(
      buildReviewPayload(event.id, {
        type: ReviewType.ORGANIZER,
        title: "Responsive organizer",
      }),
    );

    // Assert
    expect(response.status).toBe(201);
    expect(response.body.data.type).toBe(ReviewType.ORGANIZER);
    expect(await prisma.review.count({ where: { orderId: order.id } })).toBe(2);
  });

  it("should attach the review to the authenticated customer's own paid order", async () => {
    // Arrange
    const { customer, event, ticket, order } = await createAttendedEvent();
    const otherCustomer = await createCustomer();
    const otherOrder = await createPaidOrder(otherCustomer.id, ticket.id);

    // Act
    const response = await postReview(signAccessToken(customer)).send(
      buildReviewPayload(event.id),
    );

    // Assert
    expect(response.status).toBe(201);
    expect(response.body.data.orderId).toBe(order.id);
    expect(response.body.data.orderId).not.toBe(otherOrder.id);
  });

  it("should attach the review to the paid order when an unpaid order exists too", async () => {
    // Arrange
    const customer = await createCustomer();
    const { organization } = await createOrganizer();
    const { event, ticket } = await createEndedEvent(organization.id);
    await createOrder(customer.id, ticket.id, {
      paymentStatus: PaymentStatus.WAITING_FOR_CONFIRMATION,
    });
    const paidOrder = await createPaidOrder(customer.id, ticket.id);

    // Act
    const response = await postReview(signAccessToken(customer)).send(
      buildReviewPayload(event.id),
    );

    // Assert
    expect(response.status).toBe(201);
    expect(response.body.data.orderId).toBe(paidOrder.id);
  });

  it("should accept a paid order for any ticket type of the event", async () => {
    // Arrange
    const customer = await createCustomer();
    const { organization } = await createOrganizer();
    const { event } = await createEndedEvent(organization.id, {
      tickets: [
        { name: "VIP", price: 500_000 },
        { name: "General Admission", price: 100_000 },
      ],
    });
    const generalAdmission = event.tickets.find(
      (ticket) => ticket.name === "General Admission",
    )!;
    const order = await createPaidOrder(customer.id, generalAdmission.id);

    // Act
    const response = await postReview(signAccessToken(customer)).send(
      buildReviewPayload(event.id),
    );

    // Assert
    expect(response.status).toBe(201);
    expect(response.body.data.orderId).toBe(order.id);
  });

  it("should ignore extra fields such as a foreign orderId and userId", async () => {
    // Arrange
    const { customer, event, ticket, order } = await createAttendedEvent();
    const otherCustomer = await createCustomer();
    const otherOrder = await createPaidOrder(otherCustomer.id, ticket.id);

    // Act
    const response = await postReview(signAccessToken(customer)).send({
      ...buildReviewPayload(event.id),
      orderId: otherOrder.id,
      userId: otherCustomer.id,
    });

    // Assert
    expect(response.status).toBe(201);
    expect(response.body.data.orderId).toBe(order.id);

    const savedReview = await prisma.review.findFirstOrThrow();
    expect(savedReview.orderId).toBe(order.id);
  });

  it("should trim the title and comment and coerce numeric strings", async () => {
    // Arrange
    const { customer, event } = await createAttendedEvent();

    // Act
    const response = await postReview(signAccessToken(customer)).send(
      buildReviewPayload(String(event.id), {
        rating: "4",
        title: "  Nice show  ",
        comment: "  Sound and lighting were excellent.\n  ",
      }),
    );

    // Assert
    expect(response.status).toBe(201);
    expect(response.body.data).toMatchObject({
      rating: 4,
      title: "Nice show",
      comment: "Sound and lighting were excellent.",
    });

    const savedReview = await prisma.review.findFirstOrThrow();
    expect(savedReview.rating).toBe(4);
    expect(savedReview.title).toBe("Nice show");
    expect(savedReview.comment).toBe("Sound and lighting were excellent.");
  });

  it("should preserve unicode characters and internal line breaks", async () => {
    // Arrange
    const { customer, event } = await createAttendedEvent();

    // Act
    const response = await postReview(signAccessToken(customer)).send(
      buildReviewPayload(event.id, {
        title: "  Konser luar biasa 🎉  ",
        comment: "  Baris pertama.\nBaris kedua — 最高!\n  ",
      }),
    );

    // Assert
    expect(response.status).toBe(201);
    expect(response.body.data.title).toBe("Konser luar biasa 🎉");
    expect(response.body.data.comment).toBe(
      "Baris pertama.\nBaris kedua — 最高!",
    );
  });

  it.each([1, 3, 5])("should accept a rating of %i stars", async (rating) => {
    // Arrange
    const { customer, event } = await createAttendedEvent();

    // Act
    const response = await postReview(signAccessToken(customer)).send(
      buildReviewPayload(event.id, { rating }),
    );

    // Assert
    expect(response.status).toBe(201);
    expect(response.body.data.rating).toBe(rating);
  });

  const lengthBoundaries: Array<[string, number, number]> = [
    ["minimum", 3, 10],
    ["maximum", 100, 1000],
  ];

  it.each(lengthBoundaries)(
    "should accept %s title and comment lengths",
    async (_label, titleLength, commentLength) => {
      // Arrange
      const { customer, event } = await createAttendedEvent();
      const title = "a".repeat(titleLength);
      const comment = "b".repeat(commentLength);

      // Act
      const response = await postReview(signAccessToken(customer)).send(
        buildReviewPayload(event.id, { title, comment }),
      );

      // Assert
      expect(response.status).toBe(201);
      expect(response.body.data.title).toBe(title);
      expect(response.body.data.comment).toBe(comment);
    },
  );

  it("should work with a token obtained from the login endpoint", async () => {
    // Arrange
    const { customer, event } = await createAttendedEvent();
    const loginResponse = await request(app).post("/api/auth/login").send({
      email: customer.email,
      password: TEST_PASSWORD,
    });

    // Act
    const response = await postReview(loginResponse.body.accessToken).send(
      buildReviewPayload(event.id),
    );

    // Assert
    expect(loginResponse.status).toBe(200);
    expect(response.status).toBe(201);
    expect(response.body.data.type).toBe(ReviewType.EVENT);
  });

  it.each([ReviewType.EVENT, ReviewType.ORGANIZER])(
    "should return 409 when the same %s review is submitted twice",
    async (type) => {
      // Arrange
      const { customer, event, order } = await createAttendedEvent();
      const existingReview = await createReview(order.id, { type });

      // Act
      const response = await postReview(signAccessToken(customer)).send(
        buildReviewPayload(event.id, {
          type,
          rating: 1,
          title: "Duplicate attempt",
          comment: "This review should never be saved.",
        }),
      );

      // Assert
      expect(response.status).toBe(409);
      expect(response.body.message).toBe(ALREADY_REVIEWED_MESSAGE);
      expect(await prisma.review.count({ where: { orderId: order.id } })).toBe(
        1,
      );

      const savedReview = await prisma.review.findUniqueOrThrow({
        where: { id: existingReview.id },
      });
      expect(savedReview).toMatchObject({
        rating: 5,
        title: "Great event",
        comment: "Everything was well organized and fun.",
      });
    },
  );

  it("should return 400 when the event has not started yet", async () => {
    // Arrange
    const customer = await createCustomer();
    const { organization } = await createOrganizer();
    const { event, ticket } = await createEvent(organization.id);
    await createPaidOrder(customer.id, ticket.id);

    // Act
    const response = await postReview(signAccessToken(customer)).send(
      buildReviewPayload(event.id),
    );

    // Assert
    expect(response.status).toBe(400);
    expect(response.body.message).toBe(EVENT_NOT_ENDED_MESSAGE);
    expect(await prisma.review.count()).toBe(0);
  });

  it("should return 400 when the event is still ongoing", async () => {
    // Arrange
    const customer = await createCustomer();
    const { organization } = await createOrganizer();
    const { event, ticket } = await createEndedEvent(organization.id, {
      startDate: new Date(Date.now() - DAY_IN_MS),
      endDate: new Date(Date.now() + DAY_IN_MS),
    });
    await createPaidOrder(customer.id, ticket.id);

    // Act
    const response = await postReview(signAccessToken(customer)).send(
      buildReviewPayload(event.id),
    );

    // Assert
    expect(response.status).toBe(400);
    expect(response.body.message).toBe(EVENT_NOT_ENDED_MESSAGE);
    expect(await prisma.review.count()).toBe(0);
  });

  it("should check that the event ended before checking the customer's order", async () => {
    // Arrange
    const customer = await createCustomer();
    const { organization } = await createOrganizer();
    const { event } = await createEvent(organization.id);

    // Act
    const response = await postReview(signAccessToken(customer)).send(
      buildReviewPayload(event.id),
    );

    // Assert
    expect(response.status).toBe(400);
    expect(response.body.message).toBe(EVENT_NOT_ENDED_MESSAGE);
  });

  it("should return 404 when the event does not exist", async () => {
    // Arrange
    const customer = await createCustomer();

    // Act
    const response = await postReview(signAccessToken(customer)).send(
      buildReviewPayload(999_999),
    );

    // Assert
    expect(response.status).toBe(404);
    expect(response.body.message).toBe(EVENT_NOT_FOUND_MESSAGE);
    expect(await prisma.review.count()).toBe(0);
  });

  it("should return 404 when the event has been deleted", async () => {
    // Arrange
    const customer = await createCustomer();
    const { organization } = await createOrganizer();
    const { event, ticket } = await createEndedEvent(organization.id, {
      deletedAt: new Date(),
    });
    await createPaidOrder(customer.id, ticket.id);

    // Act
    const response = await postReview(signAccessToken(customer)).send(
      buildReviewPayload(event.id),
    );

    // Assert
    expect(response.status).toBe(404);
    expect(response.body.message).toBe(EVENT_NOT_FOUND_MESSAGE);
    expect(await prisma.review.count()).toBe(0);
  });

  it("should return 403 when the paid order is for another event", async () => {
    // Arrange
    const { customer, organization } = await createAttendedEvent();
    const { event: otherEvent } = await createEndedEvent(organization.id, {
      name: "Another event",
    });

    // Act
    const response = await postReview(signAccessToken(customer)).send(
      buildReviewPayload(otherEvent.id),
    );

    // Assert
    expect(response.status).toBe(403);
    expect(response.body.message).toBe(NOT_ATTENDED_MESSAGE);
    expect(await prisma.review.count()).toBe(0);
  });

  it.each([
    PaymentStatus.WAITING_FOR_PAYMENT,
    PaymentStatus.WAITING_FOR_CONFIRMATION,
    PaymentStatus.REJECTED,
    PaymentStatus.EXPIRED,
    PaymentStatus.CANCELED,
  ])("should return 403 when the order status is %s", async (paymentStatus) => {
    // Arrange
    const customer = await createCustomer();
    const { organization } = await createOrganizer();
    const { event, ticket } = await createEndedEvent(organization.id);
    await createOrder(customer.id, ticket.id, { paymentStatus });

    // Act
    const response = await postReview(signAccessToken(customer)).send(
      buildReviewPayload(event.id),
    );

    // Assert
    expect(response.status).toBe(403);
    expect(response.body.message).toBe(NOT_ATTENDED_MESSAGE);
    expect(await prisma.review.count()).toBe(0);
  });

  it("should return 403 when the customer has no order at all", async () => {
    // Arrange
    const customer = await createCustomer();
    const { organization } = await createOrganizer();
    const { event } = await createEndedEvent(organization.id);

    // Act
    const response = await postReview(signAccessToken(customer)).send(
      buildReviewPayload(event.id),
    );

    // Assert
    expect(response.status).toBe(403);
    expect(response.body.message).toBe(NOT_ATTENDED_MESSAGE);
    expect(await prisma.review.count()).toBe(0);
  });

  it("should return 403 when the paid order belongs to another customer", async () => {
    // Arrange
    const { event } = await createAttendedEvent();
    const otherCustomer = await createCustomer();

    // Act
    const response = await postReview(signAccessToken(otherCustomer)).send(
      buildReviewPayload(event.id),
    );

    // Assert
    expect(response.status).toBe(403);
    expect(response.body.message).toBe(NOT_ATTENDED_MESSAGE);
    expect(await prisma.review.count()).toBe(0);
  });

  it("should return 400 when the body is empty", async () => {
    // Arrange
    const { customer } = await createAttendedEvent();

    // Act
    const response = await postReview(signAccessToken(customer)).send({});

    // Assert
    expect(response.status).toBe(400);
    expect(response.body.message).toContain("eventId");
    expect(await prisma.review.count()).toBe(0);
  });

  const invalidPayloads: Array<[string, Record<string, unknown>, string]> = [
    ["the event id is missing", { eventId: undefined }, "eventId:"],
    ["the event id is zero", { eventId: 0 }, "Invalid event ID"],
    ["the event id is negative", { eventId: -1 }, "Invalid event ID"],
    ["the event id is a decimal", { eventId: 1.5 }, "eventId:"],
    ["the event id is not a number", { eventId: "abc" }, "eventId:"],
    ["the event id is an empty string", { eventId: "" }, "Invalid event ID"],
    ["the review type is missing", { type: undefined }, "type:"],
    ["the review type is unknown", { type: "VENUE" }, "type:"],
    ["the review type is lowercase", { type: "event" }, "type:"],
    ["the rating is missing", { rating: undefined }, "rating:"],
    [
      "the rating is below 1",
      { rating: 0 },
      "Rating must be at least 1 star",
    ],
    [
      "the rating is above 5",
      { rating: 6 },
      "Rating cannot exceed 5 stars",
    ],
    ["the rating is a decimal", { rating: 4.5 }, "rating:"],
    ["the rating is not a number", { rating: "five" }, "rating:"],
    ["the title is missing", { title: undefined }, "title:"],
    [
      "the title is shorter than 3 characters",
      { title: "Ok" },
      "Title must be at least 3 characters",
    ],
    [
      "the title is blank",
      { title: "   " },
      "Title must be at least 3 characters",
    ],
    [
      "the title is longer than 100 characters",
      { title: "a".repeat(101) },
      "Title cannot exceed 100 characters",
    ],
    ["the title is not a string", { title: 123 }, "title:"],
    ["the comment is missing", { comment: undefined }, "comment:"],
    [
      "the comment is shorter than 10 characters",
      { comment: "Too short" },
      "Review must be at least 10 characters",
    ],
    [
      "the comment is blank",
      { comment: " ".repeat(20) },
      "Review must be at least 10 characters",
    ],
    [
      "the comment is longer than 1000 characters",
      { comment: "a".repeat(1001) },
      "Review cannot exceed 1000 characters",
    ],
    ["the comment is not a string", { comment: ["nice"] }, "comment:"],
  ];

  it.each(invalidPayloads)(
    "should return 400 when %s",
    async (_case, overrides, expectedMessage) => {
      // Arrange
      const { customer, event } = await createAttendedEvent();

      // Act
      const response = await postReview(signAccessToken(customer)).send(
        buildReviewPayload(event.id, overrides),
      );

      // Assert
      expect(response.status).toBe(400);
      expect(response.body.message).toContain(expectedMessage);
      expect(await prisma.review.count()).toBe(0);
    },
  );

  it("should check authentication before validating the body", async () => {
    // Arrange
    const { event } = await createAttendedEvent();

    // Act
    const response = await postReview().send(
      buildReviewPayload(event.id, { rating: 0 }),
    );

    // Assert
    expect(response.status).toBe(401);
    expect(response.body.message).toBe("Token not provided");
  });

  it("should return 401 when no token is provided", async () => {
    // Act
    const response = await postReview().send(buildReviewPayload(1));

    // Assert
    expect(response.status).toBe(401);
    expect(response.body.message).toBe("Token not provided");
  });

  it("should return 401 when the authorization header lacks the Bearer scheme", async () => {
    // Arrange
    const { customer, event } = await createAttendedEvent();

    // Act
    const response = await request(app)
      .post("/api/reviews")
      .set("Authorization", signAccessToken(customer))
      .send(buildReviewPayload(event.id));

    // Assert
    expect(response.status).toBe(401);
    expect(response.body.message).toBe("Token not provided");
  });

  it("should return 401 for an invalid token", async () => {
    // Act
    const response = await postReview("not-a-token").send(buildReviewPayload(1));

    // Assert
    expect(response.status).toBe(401);
    expect(response.body.message).toBe("Invalid token");
  });

  it("should return 401 for an expired token", async () => {
    // Arrange
    const customer = await createCustomer();

    // Act
    const response = await postReview(signExpiredToken(customer)).send(
      buildReviewPayload(1),
    );

    // Assert
    expect(response.status).toBe(401);
    expect(response.body.message).toBe("Token expired");
  });

  it("should return 403 when an organizer has not paid for the event", async () => {
    // Arrange
    const { user } = await createOrganizer();
    const { organization } = await createOrganizer({
      organizationName: "Globex",
    });
    const { event } = await createEndedEvent(organization.id);

    // Act
    const response = await postReview(signAccessToken(user)).send(
      buildReviewPayload(event.id),
    );

    // Assert
    expect(response.status).toBe(403);
    expect(response.body.message).toBe(NOT_ATTENDED_MESSAGE);
    expect(await prisma.review.count()).toBe(0);
  });
});
