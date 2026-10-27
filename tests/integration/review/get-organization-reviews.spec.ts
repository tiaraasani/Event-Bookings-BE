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

const REVIEWS_RETRIEVED_MESSAGE = "Organizer reviews retrieved successfully";
const ORGANIZATION_NOT_FOUND_MESSAGE = "Organization not found";
const INVALID_ORGANIZATION_ID_MESSAGE = "Invalid organization ID";

function getOrganizationReviews(organizationId: number | string) {
  return request(app).get(`/api/reviews/organization/${organizationId}`);
}

describe("GET /reviews/organization/:organizationId", () => {
  it("should return organizer reviews across all the organization's events, newest first", async () => {
    // Arrange
    const { organization } = await createOrganizer();
    const concert = await createEndedEvent(organization.id, {
      name: "Concert",
    });
    const workshop = await createEndedEvent(organization.id, {
      name: "Workshop",
    });

    const budi = await createCustomer({ name: "Budi" });
    const sari = await createCustomer({ name: "Sari" });
    const dina = await createCustomer({ name: "Dina" });

    const budiOrder = await createPaidOrder(budi.id, concert.ticket.id);
    const sariOrder = await createPaidOrder(sari.id, concert.ticket.id);
    const dinaOrder = await createPaidOrder(dina.id, workshop.ticket.id);

    const oldestReview = await createReview(budiOrder.id, {
      type: ReviewType.ORGANIZER,
      title: "Oldest review",
      rating: 2,
    });
    const middleReview = await createReview(sariOrder.id, {
      type: ReviewType.ORGANIZER,
      title: "Middle review",
      rating: 4,
    });
    const newestReview = await createReview(dinaOrder.id, {
      type: ReviewType.ORGANIZER,
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
    const response = await getOrganizationReviews(organization.id);

    // Assert
    expect(response.status).toBe(200);
    expect(response.body.message).toBe(REVIEWS_RETRIEVED_MESSAGE);
    expect(response.body.data).toHaveLength(3);
    expect(
      response.body.data.map((review: { id: number }) => review.id),
    ).toEqual([newestReview.id, middleReview.id, oldestReview.id]);

    expect(response.body.data[0]).toMatchObject({
      orderId: dinaOrder.id,
      type: ReviewType.ORGANIZER,
      rating: 5,
      title: "Newest review",
      comment: "Everything was well organized and fun.",
      order: {
        user: { id: dina.id, name: "Dina" },
        ticket: { event: { id: workshop.event.id, name: "Workshop" } },
      },
    });
    expect(response.body.data[1].order.ticket.event).toEqual({
      id: concert.event.id,
      name: "Concert",
    });
  });

  it("should return only the review fields, the reviewer and the event summary", async () => {
    // Arrange
    const { organization } = await createOrganizer();
    const { event, ticket } = await createEndedEvent(organization.id, {
      name: "Concert",
    });
    const customer = await createCustomer({ name: "Budi" });
    const order = await createPaidOrder(customer.id, ticket.id);
    const review = await createReview(order.id, {
      type: ReviewType.ORGANIZER,
    });

    // Act
    const response = await getOrganizationReviews(organization.id);

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
    expect(Object.keys(returnedReview.order).sort()).toEqual([
      "ticket",
      "user",
    ]);
    expect(returnedReview.order.user).toEqual({
      id: customer.id,
      name: "Budi",
    });
    expect(returnedReview.order.ticket).toEqual({
      event: { id: event.id, name: "Concert" },
    });

    const body = JSON.stringify(response.body);
    expect(body).not.toContain("password");
    expect(body).not.toContain(customer.email);
  });

  it("should only return ORGANIZER reviews, not EVENT reviews", async () => {
    // Arrange
    const { organization } = await createOrganizer();
    const { ticket } = await createEndedEvent(organization.id);
    const customer = await createCustomer();
    const order = await createPaidOrder(customer.id, ticket.id);
    await createReview(order.id, { type: ReviewType.EVENT, title: "Event" });
    await createReview(order.id, {
      type: ReviewType.ORGANIZER,
      title: "Organizer",
    });

    // Act
    const response = await getOrganizationReviews(organization.id);

    // Assert
    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0].title).toBe("Organizer");
    expect(response.body.data[0].type).toBe(ReviewType.ORGANIZER);
  });

  it("should return an empty list when the organization only has event reviews", async () => {
    // Arrange
    const { organization } = await createOrganizer();
    const { ticket } = await createEndedEvent(organization.id);
    const customer = await createCustomer();
    const order = await createPaidOrder(customer.id, ticket.id);
    await createReview(order.id, { type: ReviewType.EVENT });

    // Act
    const response = await getOrganizationReviews(organization.id);

    // Assert
    expect(response.status).toBe(200);
    expect(response.body.data).toEqual([]);
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
    await createReview(acmeOrder.id, {
      type: ReviewType.ORGANIZER,
      title: "Acme review",
    });
    await createReview(globexOrder.id, {
      type: ReviewType.ORGANIZER,
      title: "Globex review",
    });

    // Act
    const acmeResponse = await getOrganizationReviews(acme.organization.id);
    const globexResponse = await getOrganizationReviews(
      globex.organization.id,
    );

    // Assert
    expect(acmeResponse.status).toBe(200);
    expect(acmeResponse.body.data).toHaveLength(1);
    expect(acmeResponse.body.data[0].title).toBe("Acme review");

    expect(globexResponse.status).toBe(200);
    expect(globexResponse.body.data).toHaveLength(1);
    expect(globexResponse.body.data[0].title).toBe("Globex review");
  });

  it("should return every organizer review from the same customer across events", async () => {
    // Arrange
    const { organization } = await createOrganizer();
    const concert = await createEndedEvent(organization.id, {
      name: "Concert",
    });
    const workshop = await createEndedEvent(organization.id, {
      name: "Workshop",
    });
    const customer = await createCustomer({ name: "Budi" });
    const concertOrder = await createPaidOrder(customer.id, concert.ticket.id);
    const workshopOrder = await createPaidOrder(
      customer.id,
      workshop.ticket.id,
    );
    await createReview(concertOrder.id, {
      type: ReviewType.ORGANIZER,
      title: "Concert review",
    });
    await createReview(workshopOrder.id, {
      type: ReviewType.ORGANIZER,
      title: "Workshop review",
    });

    // Act
    const response = await getOrganizationReviews(organization.id);

    // Assert
    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(2);
    expect(
      response.body.data.map((review: { title: string }) => review.title),
    ).toEqual(
      expect.arrayContaining(["Concert review", "Workshop review"]),
    );
    expect(
      response.body.data.every(
        (review: { order: { user: { id: number } } }) =>
          review.order.user.id === customer.id,
      ),
    ).toBe(true);
  });

  it("should still return the organizer reviews of a soft-deleted event", async () => {
    // Arrange
    const { organization } = await createOrganizer();
    const { event, ticket } = await createEndedEvent(organization.id, {
      name: "Deleted event",
      deletedAt: new Date(),
    });
    const customer = await createCustomer();
    const order = await createPaidOrder(customer.id, ticket.id);
    await createReview(order.id, {
      type: ReviewType.ORGANIZER,
      title: "Still readable",
    });

    // Act
    const response = await getOrganizationReviews(organization.id);

    // Assert
    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0].title).toBe("Still readable");
    expect(response.body.data[0].order.ticket.event).toEqual({
      id: event.id,
      name: "Deleted event",
    });
  });

  it("should return an empty list when the organization has no reviews", async () => {
    // Arrange
    const { organization } = await createOrganizer();
    await createEndedEvent(organization.id);

    // Act
    const response = await getOrganizationReviews(organization.id);

    // Assert
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      message: REVIEWS_RETRIEVED_MESSAGE,
      data: [],
    });
  });

  it("should return an empty list when the organization has no events yet", async () => {
    // Arrange
    const { organization } = await createOrganizer();

    // Act
    const response = await getOrganizationReviews(organization.id);

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
    const { ticket } = await createEndedEvent(organization.id);
    const customer = await createCustomer();
    const order = await createPaidOrder(customer.id, ticket.id);
    await createReview(order.id, { type: ReviewType.ORGANIZER });

    // Act
    const response = await getOrganizationReviews(organization.id);

    // Assert
    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(1);
  });

  it("should ignore an invalid authorization header because the endpoint is public", async () => {
    // Arrange
    const { organization } = await createOrganizer();

    // Act
    const response = await request(app)
      .get(`/api/reviews/organization/${organization.id}`)
      .set("Authorization", "Bearer not-a-real-token");

    // Assert
    expect(response.status).toBe(200);
    expect(response.body.data).toEqual([]);
  });

  it.each([999_999, 2_147_483_647])(
    "should return 404 when the organization does not exist (%i)",
    async (organizationId) => {
      // Act
      const response = await getOrganizationReviews(organizationId);

      // Assert
      expect(response.status).toBe(404);
      expect(response.body.message).toBe(ORGANIZATION_NOT_FOUND_MESSAGE);
    },
  );

  it.each(["abc", "0", "-1", "1.5", "Infinity"])(
    "should return 400 for an invalid organization id (%s)",
    async (organizationId) => {
      // Act
      const response = await getOrganizationReviews(organizationId);

      // Assert
      expect(response.status).toBe(400);
      expect(response.body.message).toBe(INVALID_ORGANIZATION_ID_MESSAGE);
    },
  );
});
