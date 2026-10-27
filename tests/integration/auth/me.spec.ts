import request from "supertest";
import { describe, expect, it } from "vitest";
import { Role } from "../../../src/generated/prisma/enums.js";
import { app } from "../../../src/app.js";
import {
  TEST_PASSWORD,
  createCustomer,
  createOrganizer,
  signAccessToken,
  signExpiredToken,
} from "../../helpers/factories.js";

function getMe(token?: string) {
  const req = request(app).get("/api/auth/me");

  if (token !== undefined) {
    req.set("Authorization", `Bearer ${token}`);
  }

  return req;
}

describe("GET /auth/me", () => {
  it("should return the id and role stored in the token", async () => {
    const customer = await createCustomer();

    const response = await getMe(signAccessToken(customer));

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      id: customer.id,
      role: Role.CUSTOMER,
    });
  });

  it("should return the organizer role for an organizer token", async () => {
    const { user } = await createOrganizer();

    const response = await getMe(signAccessToken(user));

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ id: user.id, role: Role.ORGANIZER });
  });

  it("should not expose the password or other profile fields", async () => {
    const customer = await createCustomer();

    const response = await getMe(signAccessToken(customer));

    expect(response.status).toBe(200);
    expect(response.body).not.toHaveProperty("password");
    expect(response.body).not.toHaveProperty("email");
  });

  it("should work with a token obtained from the login endpoint", async () => {
    const customer = await createCustomer();
    const loginResponse = await request(app).post("/api/auth/login").send({
      email: customer.email,
      password: TEST_PASSWORD,
    });

    const response = await getMe(loginResponse.body.accessToken);

    expect(response.status).toBe(200);
    expect(response.body.id).toBe(customer.id);
  });

  it("should return 401 when no token is provided", async () => {
    const response = await getMe();

    expect(response.status).toBe(401);
    expect(response.body.message).toBe("Token not provided");
  });

  it("should return 401 when the authorization header lacks the Bearer scheme", async () => {
    const customer = await createCustomer();

    const response = await request(app)
      .get("/api/auth/me")
      .set("Authorization", signAccessToken(customer));

    expect(response.status).toBe(401);
    expect(response.body.message).toBe("Token not provided");
  });

  it("should return 401 for an invalid token", async () => {
    const response = await getMe("not-a-token");

    expect(response.status).toBe(401);
    expect(response.body.message).toBe("Invalid token");
  });

  it("should return 401 for an expired token", async () => {
    const customer = await createCustomer();

    const response = await getMe(signExpiredToken(customer));

    expect(response.status).toBe(401);
    expect(response.body.message).toBe("Token expired");
  });

  it("should return 401 for a token signed with the reset secret", async () => {
    const customer = await createCustomer();
    const jwt = await import("jsonwebtoken");
    const resetToken = jwt.default.sign(
      { id: customer.id, role: customer.role },
      process.env.JWT_SECRET_RESET!,
      { expiresIn: "15m" },
    );

    const response = await getMe(resetToken);

    expect(response.status).toBe(401);
    expect(response.body.message).toBe("Invalid token");
  });
});
