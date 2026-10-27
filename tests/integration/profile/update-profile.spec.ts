import request from "supertest";
import { describe, expect, it } from "vitest";
import { prisma } from "../../../src/lib/prisma.js";
import { app } from "../../../src/app.js";
import {
  createCustomer,
  signAccessToken,
  signExpiredToken,
} from "../../helpers/factories.js";

function patchProfile(payload: object, token?: string) {
  const req = request(app).patch("/api/profile");

  if (token !== undefined) {
    req.set("Authorization", `Bearer ${token}`);
  }

  return req.send(payload);
}

describe("PATCH /profile", () => {
  it("should update the user's name", async () => {
    const customer = await createCustomer({ name: "Old Name" });

    const response = await patchProfile(
      { name: "New Name" },
      signAccessToken(customer),
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ message: "Profile updated successfully" });

    const updated = await prisma.user.findUniqueOrThrow({
      where: { id: customer.id },
    });
    expect(updated.name).toBe("New Name");
    expect(updated.email).toBe(customer.email);
  });

  it("should only update the authenticated user", async () => {
    const customer = await createCustomer({ name: "Me" });
    const other = await createCustomer({ name: "Someone Else" });

    await patchProfile({ name: "Renamed" }, signAccessToken(customer));

    const untouched = await prisma.user.findUniqueOrThrow({
      where: { id: other.id },
    });
    expect(untouched.name).toBe("Someone Else");
  });

  it("should return 400 when the name is shorter than 2 characters", async () => {
    const customer = await createCustomer({ name: "Old Name" });

    const response = await patchProfile({ name: "A" }, signAccessToken(customer));

    expect(response.status).toBe(400);
    expect(response.body.message).toContain("name");

    const unchanged = await prisma.user.findUniqueOrThrow({
      where: { id: customer.id },
    });
    expect(unchanged.name).toBe("Old Name");
  });

  it("should return 400 when the name is missing", async () => {
    const customer = await createCustomer();

    const response = await patchProfile({}, signAccessToken(customer));

    expect(response.status).toBe(400);
  });

  it("should return 400 when unknown fields are sent", async () => {
    const customer = await createCustomer();

    const response = await patchProfile(
      { name: "New Name", email: "hacker@mail.com", role: "ORGANIZER" },
      signAccessToken(customer),
    );

    expect(response.status).toBe(400);

    const unchanged = await prisma.user.findUniqueOrThrow({
      where: { id: customer.id },
    });
    expect(unchanged.email).toBe(customer.email);
    expect(unchanged.role).toBe(customer.role);
  });

  it("should return 401 when no token is provided", async () => {
    const response = await patchProfile({ name: "New Name" });

    expect(response.status).toBe(401);
    expect(response.body.message).toBe("Token not provided");
  });

  it("should return 401 for an invalid token", async () => {
    const response = await patchProfile({ name: "New Name" }, "not-a-token");

    expect(response.status).toBe(401);
    expect(response.body.message).toBe("Invalid token");
  });

  it("should return 401 for an expired token", async () => {
    const customer = await createCustomer();

    const response = await patchProfile(
      { name: "New Name" },
      signExpiredToken(customer),
    );

    expect(response.status).toBe(401);
    expect(response.body.message).toBe("Token expired");
  });
});
