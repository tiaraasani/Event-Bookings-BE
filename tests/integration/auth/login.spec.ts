import { describe, expect, it } from "vitest";
import { Role } from "../../../src/generated/prisma/enums.js";
import argon from "argon2";
import jwt from "jsonwebtoken";
import { prisma } from "../../../src/lib/prisma.js";
import request from "supertest";
import { app } from "../../../src/app.js";

type TestUserOverrides = {
  name?: string;
  email?: string;
  password?: string;
  role?: Role;
  picture?: string | null;
};

let userSequence = 0;

async function createUser(overrides: TestUserOverrides = {}) {
  userSequence += 1;

  const password = overrides.password ?? "Test123!";
  const user = await prisma.user.create({
    data: {
      name: overrides.name ?? "test",
      email: overrides.email ?? `test-${Date.now()}-${userSequence}@mail.com`,
      password: await argon.hash(password),
      role: overrides.role ?? Role.CUSTOMER,
      referralCode: `REF${Date.now()}${userSequence}`,
      picture: overrides.picture ?? null,
    },
  });

  return { user, password };
}

describe("POST /auth/login", () => {
  it("should login successfully", async () => {
    // Arrange
    const { user, password } = await createUser();

    // Act
    const response = await request(app).post("/api/auth/login").send({
      email: user.email,
      password,
    });

    // Assert
    expect(response.status).toBe(200);
    expect(response.body.message).toBe("Login success");
    expect(response.body.accessToken).toBeDefined();
    expect(response.body.user.id).toBeDefined();
    expect(response.body.user.email).toBe(user.email);
    expect(response.body.user.role).toBe(Role.CUSTOMER);
    expect(response.body.user.password).toBeUndefined();
  });

  it("should login an organizer and return their profile", async () => {
    // Arrange
    const { user, password } = await createUser({
      name: "organizer",
      role: Role.ORGANIZER,
      picture: "https://example.com/avatar.png",
    });

    // Act
    const response = await request(app).post("/api/auth/login").send({
      email: user.email,
      password,
    });

    // Assert
    expect(response.status).toBe(200);
    expect(response.body.message).toBe("Login success");
    expect(response.body.user).toEqual({
      id: user.id,
      name: "organizer",
      email: user.email,
      role: Role.ORGANIZER,
      picture: "https://example.com/avatar.png",
      referralCode: user.referralCode,
    });
    expect(response.body.user.password).toBeUndefined();
  });

  it("should return error when email does not exist", async () => {
    // Act
    const response = await request(app)
      .post("/api/auth/login")
      .send({
        email: `notexists-${Date.now()}@mail.com`,
        password: "Test123!",
      });

    // Assert
    expect(response.status).toBe(400);
    expect(response.body.message).toBe("Invalid email or password");
    expect(response.body.accessToken).toBeUndefined();
  });

  it("should return error when password is wrong", async () => {
    // Arrange
    const { user } = await createUser();

    // Act
    const response = await request(app).post("/api/auth/login").send({
      email: user.email,
      password: "WrongPassword123!",
    });

    // Assert
    expect(response.status).toBe(400);
    expect(response.body.message).toBe("Invalid email or password");
    expect(response.body.accessToken).toBeUndefined();
  });

  it("should treat the password as case-sensitive", async () => {
    // Arrange
    const { user } = await createUser({ password: "Test123!" });

    // Act
    const response = await request(app).post("/api/auth/login").send({
      email: user.email,
      password: "test123!",
    });

    // Assert
    expect(response.status).toBe(400);
    expect(response.body.message).toBe("Invalid email or password");
    expect(response.body.accessToken).toBeUndefined();
  });

  it("should return error when email format is invalid", async () => {
    // Act
    const response = await request(app).post("/api/auth/login").send({
      email: "Invalid Email Format",
      password: "Test123!",
    });

    // Assert
    expect(response.status).toBe(400);
    expect(response.body.message).toBe("email: Invalid email address");
  });

  it("should return error when email is empty", async () => {
    // Act
    const response = await request(app).post("/api/auth/login").send({
      email: "",
      password: "Test123!",
    });

    // Assert
    expect(response.status).toBe(400);
    expect(response.body.message).toBe("email: Invalid email address");
  });

  it("should return error when password is empty", async () => {
    // Arrange
    const { user } = await createUser();

    // Act
    const response = await request(app).post("/api/auth/login").send({
      email: user.email,
      password: "",
    });

    // Assert
    expect(response.status).toBe(400);
    expect(response.body.message).toBe(
      "password: Too small: expected string to have >=1 characters",
    );
  });

  it("should return error when credentials are missing", async () => {
    // Act
    const response = await request(app).post("/api/auth/login").send({});

    // Assert
    expect(response.status).toBe(400);
    expect(response.body.message).toBe(
      "email: Invalid input: expected string, received undefined, password: Invalid input: expected string, received undefined",
    );
  });

  it("should return error when email and password are not strings", async () => {
    // Act
    const response = await request(app).post("/api/auth/login").send({
      email: null,
      password: 123,
    });

    // Assert
    expect(response.status).toBe(400);
    expect(response.body.message).toBe(
      "email: Invalid input: expected string, received null, password: Invalid input: expected string, received number",
    );
  });

  it("should ignore extra fields such as role when logging in", async () => {
    // Arrange
    const { user, password } = await createUser({ role: Role.CUSTOMER });

    // Act
    const response = await request(app).post("/api/auth/login").send({
      email: user.email,
      password,
      role: Role.ORGANIZER,
    });

    // Assert
    expect(response.status).toBe(200);
    expect(response.body.user.role).toBe(Role.CUSTOMER);
  });

  it("should return a JWT containing the user id and role", async () => {
    // Arrange
    const { user, password } = await createUser({ role: Role.ORGANIZER });

    // Act
    const response = await request(app).post("/api/auth/login").send({
      email: user.email,
      password,
    });

    // Assert
    const payload = jwt.verify(
      response.body.accessToken,
      process.env.JWT_SECRET!,
    ) as jwt.JwtPayload & { id: number; role: Role };

    expect(payload.id).toBe(user.id);
    expect(payload.role).toBe(Role.ORGANIZER);
    expect(payload.exp! - payload.iat!).toBe(24 * 60 * 60);
  });

  it("should allow access to a protected route with the returned token", async () => {
    // Arrange
    const { user, password } = await createUser();

    const loginResponse = await request(app).post("/api/auth/login").send({
      email: user.email,
      password,
    });

    // Act
    const response = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${loginResponse.body.accessToken}`);

    // Assert
    expect(response.status).toBe(200);
    expect(response.body.id).toBe(user.id);
    expect(response.body.role).toBe(Role.CUSTOMER);
  });
});
