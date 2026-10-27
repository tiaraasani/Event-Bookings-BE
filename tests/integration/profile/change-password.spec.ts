import argon from "argon2";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { Role } from "../../../src/generated/prisma/enums.js";
import { prisma } from "../../../src/lib/prisma.js";
import { app } from "../../../src/app.js";
import {
  TEST_PASSWORD,
  createCustomer,
  signAccessToken,
  signExpiredToken,
} from "../../helpers/factories.js";

function changePassword(payload: object, token?: string) {
  const req = request(app).patch("/api/profile/password");

  if (token !== undefined) {
    req.set("Authorization", `Bearer ${token}`);
  }

  return req.send(payload);
}

function login(email: string, password: string) {
  return request(app).post("/api/auth/login").send({ email, password });
}

describe("PATCH /profile/password", () => {
  it("should change the password when the current password is correct", async () => {
    const customer = await createCustomer();

    const response = await changePassword(
      { currentPassword: TEST_PASSWORD, newPassword: "NewPass456!" },
      signAccessToken(customer),
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ message: "Password changed successfully" });

    const updated = await prisma.user.findUniqueOrThrow({
      where: { id: customer.id },
    });
    expect(updated.password).not.toBe(customer.password);
    expect(await argon.verify(updated.password, "NewPass456!")).toBe(true);
    expect(await argon.verify(updated.password, TEST_PASSWORD)).toBe(false);
  });

  it("should allow logging in with the new password and reject the old one", async () => {
    const customer = await createCustomer();
    await changePassword(
      { currentPassword: TEST_PASSWORD, newPassword: "NewPass456!" },
      signAccessToken(customer),
    );

    const withNewPassword = await login(customer.email, "NewPass456!");
    expect(withNewPassword.status).toBe(200);

    const withOldPassword = await login(customer.email, TEST_PASSWORD);
    expect(withOldPassword.status).toBe(400);
    expect(withOldPassword.body.message).toBe("Invalid email or password");
  });

  it("should return 400 when the current password is wrong", async () => {
    const customer = await createCustomer();

    const response = await changePassword(
      { currentPassword: "WrongPass!", newPassword: "NewPass456!" },
      signAccessToken(customer),
    );

    expect(response.status).toBe(400);
    expect(response.body.message).toBe("Current password is incorrect");

    const unchanged = await prisma.user.findUniqueOrThrow({
      where: { id: customer.id },
    });
    expect(unchanged.password).toBe(customer.password);
  });

  it("should return 400 when the new password is shorter than 6 characters", async () => {
    const customer = await createCustomer();

    const response = await changePassword(
      { currentPassword: TEST_PASSWORD, newPassword: "abc" },
      signAccessToken(customer),
    );

    expect(response.status).toBe(400);
    expect(response.body.message).toContain("newPassword");
  });

  it.each([
    ["currentPassword is missing", { newPassword: "NewPass456!" }],
    ["currentPassword is empty", { currentPassword: "", newPassword: "NewPass456!" }],
    ["newPassword is missing", { currentPassword: TEST_PASSWORD }],
    [
      "unknown fields are sent",
      {
        currentPassword: TEST_PASSWORD,
        newPassword: "NewPass456!",
        role: "ORGANIZER",
      },
    ],
  ])("should return 400 when %s", async (_label, payload) => {
    const customer = await createCustomer();

    const response = await changePassword(payload, signAccessToken(customer));

    expect(response.status).toBe(400);

    const unchanged = await prisma.user.findUniqueOrThrow({
      where: { id: customer.id },
    });
    expect(unchanged.password).toBe(customer.password);
  });

  it("should return 404 when the user in the token no longer exists", async () => {
    const response = await changePassword(
      { currentPassword: TEST_PASSWORD, newPassword: "NewPass456!" },
      signAccessToken({ id: 999_999, role: Role.CUSTOMER }),
    );

    expect(response.status).toBe(404);
    expect(response.body.message).toBe("User not found");
  });

  it("should return 401 when no token is provided", async () => {
    const response = await changePassword({
      currentPassword: TEST_PASSWORD,
      newPassword: "NewPass456!",
    });

    expect(response.status).toBe(401);
    expect(response.body.message).toBe("Token not provided");
  });

  it("should return 401 for an invalid token", async () => {
    const response = await changePassword(
      { currentPassword: TEST_PASSWORD, newPassword: "NewPass456!" },
      "not-a-token",
    );

    expect(response.status).toBe(401);
    expect(response.body.message).toBe("Invalid token");
  });

  it("should return 401 for an expired token", async () => {
    const customer = await createCustomer();

    const response = await changePassword(
      { currentPassword: TEST_PASSWORD, newPassword: "NewPass456!" },
      signExpiredToken(customer),
    );

    expect(response.status).toBe(401);
    expect(response.body.message).toBe("Token expired");
  });
});
