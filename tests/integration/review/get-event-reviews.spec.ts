import request from "supertest";
import { describe, expect, it } from "vitest";
import { ReviewType } from "../../../src/generated/prisma/enums.js";
import { prisma } from "../../../src/lib/prisma.js";
import { app } from "../../../src/app.js";
import {
  DAY_IN_MS,
  createCustomer,
  createEndedEvent,
  createOrganizer,
  createPaidOrder,
  createReview,
} from "../../helpers/factories.js";

const REVIEWS_RETRIEVED_MESSAGE = "Event reviews retrieved successfully";
const EVENT_NOT_FOUND_MESSAGE = "Event not found";
const INVALID_EVENT_ID_MESSAGE = "Invalid event ID";

function getEventReviews(eventId: number | string) {
  return request(app).get(`/api/reviews/event/${eventId}`);
}

describe("GET /reviews/event/:eventId", () => {
  it("should return the event reviews with the reviewer's name, newest first", async () => {
    // Arrange
    const { organization } = await createOrganizer();
    const { event } = await createEndedEvent(organization.id, {
      tickets: [
        { name: "VIP", price: 500_000 },
        { name: "General Admission", price: 100_000 },
      ],
    });
    const vipTicket = event.tickets.find((ticket) => ticket.name === "VIP")!;
    const generalAdmission = event.tickets.find(
      (ticket) => ticket.name === "General Admission",
    )!;

    const budi = await createCustomer({ name: "Budi" });
    const sari = await createCustomer({ name: "Sari" });
    const dina = await createCustomer({ name: "Dina" });

    const budiOrder = await createPaidOrder(budi.id, vipTicket.id);
    const sariOrder = await createPaidOrder(sari.id, generalAdmission.id);
    const dinaOrder = await createPaidOrder(dina.id, vipTicket.id);

    const oldestReview = await createReview(budiOrder.id, {
      title: "Oldest review",
      rating: 2,
    });
    const middleReview = await createReview(sariOrder.id, {
      title: "Middle review",
      rating: 4,
    });
    const newestReview = await createReview(dinaOrder.id, {
      title: "Newest review",
      rating: 5,
    });

    await prisma.review.update({
      where: { id: oldestReview.id },
      data: { createdAt: new Date(Date.now() - 2 * DAY_IN_MS) },
    });
    await prisma.review.update({
      where: { id: middleReview.id },
      data: { createdAt: new Date(Date.now() - DAY_IN_MS) },
    });
    await prisma.review.update({
      where: { id: newestReview.id },
      data: { createdAt: new Date(Date.now() - 60_000) },
    });

    // Act
    const response = await getEventReviews(event.id);

    // Assert
    expect(response.status).toBe(200);
    expect(response.body.message).toBe(REVIEWS_RETRIEVED_MESSAGE);
    expect(response.body.data).toHaveLength(3);
    expect(
      response.body.data.map((review: { id: number }) => review.id),
    ).toEqual([newestReview.id, middleReview.id, oldestReview.id]);
    expect(response.body.data[0]).toMatchObject({
      orderId: dinaOrder.id,
      type: ReviewType.EVENT,
      rating: 5,
      title: "Newest review",
      comment: "Everything was well organized and fun.",
      order: { user: { id: dina.id, name: "Dina" } },
    });
  });

  it("should return only the review fields and the reviewer's id and name", async () => {
    // Arrange
    const { organization } = await createOrganizer();
    const { event, ticket } = await createEndedEvent(organization.id);
    const customer = await createCustomer({ name: "Budi" });
    const order = await createPaidOrder(customer.id, ticket.id);
    const review = await createReview(order.id);

    // Act
    const response = await getEventReviews(event.id);

    // Assert
    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(1);

    const [returnedReview] = response.body.data;
    expect(returnedReview.id).toBe(review.id);
    expect(Object.keys(returnedReview).sort()).toEqual([
      "comment",
      "createdAt",
      "id",
      "order",
      "orderId",
      "rating",
      "title",
      "type",
    ]);
    expect(Object.keys(returnedReview.order)).toEqual(["user"]);
    expect(returnedReview.order.user).toEqual({
      id: customer.id,
      name: "Budi",
    });

    const body = JSON.stringify(response.body);
    expect(body).not.toContain("password");
    expect(body).not.toContain(customer.email);
  });

  it("should only return EVENT reviews, not ORGANIZER reviews", async () => {
    // Arrange
    const { organization } = await createOrganizer();
    const { event, ticket } = await createEndedEvent(organization.id);
    const customer = await createCustomer();
    const order = await createPaidOrder(customer.id, ticket.id);
    await createReview(order.id, { type: ReviewType.EVENT, title: "Event" });
    await createReview(order.id, {
      type: ReviewType.ORGANIZER,
      title: "Organizer",
    });

    // Act
    const response = await getEventReviews(event.id);

    // Assert
    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0].title).toBe("Event");
    expect(response.body.data[0].type).toBe(ReviewType.EVENT);
  });

  it("should return an empty list when the event only has organizer reviews", async () => {
    // Arrange
    const { organization } = await createOrganizer();
    const { event, ticket } = await createEndedEvent(organization.id);
    const customer = await createCustomer();
    const order = await createPaidOrder(customer.id, ticket.id);
    await createReview(order.id, { type: ReviewType.ORGANIZER });

    // Act
    const response = await getEventReviews(event.id);

    // Assert
    expect(response.status).toBe(200);
    expect(response.body.data).toEqual([]);
  });

  it("should return every review of the event, even from the same customer", async () => {
    // Arrange
    const customer = await createCustomer({ name: "Budi" });
    const { organization } = await createOrganizer();
    const { event, ticket } = await createEndedEvent(organization.id);
    const firstOrder = await createPaidOrder(customer.id, ticket.id);
    const secondOrder = await createPaidOrder(customer.id, ticket.id);
    await createReview(firstOrder.id, { title: "First visit" });
    await createReview(secondOrder.id, { title: "Second visit" });

    // Act
    const response = await getEventReviews(event.id);

    // Assert
    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(2);
    expect(
      response.body.data.map((review: { title: string }) => review.title),
    ).toEqual(expect.arrayContaining(["First visit", "Second visit"]));
    expect(
      response.body.data.every(
        (review: { order: { user: { id: number } } }) =>
          review.order.user.id === customer.id,
      ),
    ).toBe(true);
  });

  it("should only return reviews for the requested event", async () => {
    // Arrange
    const { organization } = await createOrganizer();
    const first = await createEndedEvent(organization.id, { name: "First" });
    const second = await createEndedEvent(organization.id, { name: "Second" });
    const customer = await createCustomer();
    const firstOrder = await createPaidOrder(customer.id, first.ticket.id);
    const secondOrder = await createPaidOrder(customer.id, second.ticket.id);
    await createReview(firstOrder.id, { title: "First review" });
    await createReview(secondOrder.id, { title: "Second review" });

    // Act
    const response = await getEventReviews(first.event.id);

    // Assert
    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0].title).toBe("First review");
  });

  it("should not include reviews of another organization's events", async () => {
    // Arrange
    const acme = await createOrganizer({ organizationName: "Acme" });
    const globex = await createOrganizer({ organizationName: "Globex" });
    const acmeEvent = await createEndedEvent(acme.organization.id);
    const globexEvent = await createEndedEvent(globex.organization.id);
    const customer = await createCustomer();
    const acmeOrder = await createPaidOrder(customer.id, acmeEvent.ticket.id);
    const globexOrder = await createPaidOrder(
      customer.id,
      globexEvent.ticket.id,
    );
    await createReview(acmeOrder.id, { title: "Acme review" });
    await createReview(globexOrder.id, { title: "Globex review" });

    // Act
    const response = await getEventReviews(acmeEvent.event.id);

    // Assert
    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0].title).toBe("Acme review");
  });

  it("should still return the reviews of a soft-deleted event", async () => {
    // Arrange
    const { organization } = await createOrganizer();
    const { event, ticket } = await createEndedEvent(organization.id, {
      deletedAt: new Date(),
    });
    const customer = await createCustomer();
    const order = await createPaidOrder(customer.id, ticket.id);
    await createReview(order.id, { title: "Still readable" });

    // Act
    const response = await getEventReviews(event.id);

    // Assert
    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0].title).toBe("Still readable");
  });

  it("should return an empty list when the event has no reviews", async () => {
    // Arrange
    const { organization } = await createOrganizer();
    const { event } = await createEndedEvent(organization.id);

    // Act
    const response = await getEventReviews(event.id);

    // Assert
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      message: REVIEWS_RETRIEVED_MESSAGE,
      data: [],
    });
  });

  it("should be accessible without a token", async () => {
    // Arrange
    const { organization } = await createOrganizer();
    const { event, ticket } = await createEndedEvent(organization.id);
    const customer = await createCustomer();
    const order = await createPaidOrder(customer.id, ticket.id);
    await createReview(order.id);

    // Act
    const response = await getEventReviews(event.id);

    // Assert
    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(1);
  });

  it("should ignore an invalid authorization header because the endpoint is public", async () => {
    // Arrange
    const { organization } = await createOrganizer();
    const { event } = await createEndedEvent(organization.id);

    // Act
    const response = await request(app)
      .get(`/api/reviews/event/${event.id}`)
      .set("Authorization", "Bearer not-a-real-token");

    // Assert
    expect(response.status).toBe(200);
    expect(response.body.data).toEqual([]);
  });

  it("should return 404 when the event does not exist", async () => {
    // Act
    const response = await getEventReviews(999_999);

    // Assert
    expect(response.status).toBe(404);
    expect(response.body.message).toBe(EVENT_NOT_FOUND_MESSAGE);
  });

  it.each(["abc", "0", "-1", "1.5", "Infinity"])(
    "should return 400 for an invalid event id (%s)",
    async (eventId) => {
      // Act
      const response = await getEventReviews(eventId);

      // Assert
      expect(response.status).toBe(400);
      expect(response.body.message).toBe(INVALID_EVENT_ID_MESSAGE);
    },
  );
});
