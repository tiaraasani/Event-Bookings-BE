import { describe, expect, it } from "vitest";
import { Role } from "../../../src/generated/prisma/enums.js";
import argon from "argon2";
import { prisma } from "../../../src/lib/prisma.js";
import request from "supertest";
import { app } from "../../../src/app.js";

type RegisterPayloadOverrides = {
  name?: string;
  email?: string;
  password?: string;
  role?: Role;
  referralCode?: string;
  organizationName?: string;
};

let sequence = 0;

function buildRegisterPayload(overrides: RegisterPayloadOverrides = {}) {
  sequence += 1;

  return {
    name: overrides.name ?? "Test User",
    email: overrides.email ?? `register-${Date.now()}-${sequence}@mail.com`,
    password: overrides.password ?? "Test123!",
    ...(overrides.role !== undefined && { role: overrides.role }),
    ...(overrides.referralCode !== undefined && {
      referralCode: overrides.referralCode,
    }),
    ...(overrides.organizationName !== undefined && {
      organizationName: overrides.organizationName,
    }),
  };
}

async function createReferrer() {
  sequence += 1;

  return prisma.user.create({
    data: {
      name: "Referrer",
      email: `referrer-${Date.now()}-${sequence}@mail.com`,
      password: await argon.hash("Test123!"),
      role: Role.CUSTOMER,
      referralCode: `REF${Date.now()}${sequence}`,
    },
  });
}

describe("POST /auth/register", () => {
  it("should register a customer successfully", async () => {
    // Arrange
    const payload = buildRegisterPayload();

    // Act
    const response = await request(app)
      .post("/api/auth/register")
      .send(payload);

    // Assert
    expect(response.status).toBe(201);
    expect(response.body).toEqual({ message: "Register success" });

    const user = await prisma.user.findUniqueOrThrow({
      where: { email: payload.email },
    });
    expect(user.name).toBe(payload.name);
    expect(user.email).toBe(payload.email);
    expect(user.role).toBe(Role.CUSTOMER);
    expect(user.referralCode).toBeTruthy();
    expect(user.referredById).toBeNull();
    expect(user.password).not.toBe(payload.password);
    await expect(argon.verify(user.password, payload.password)).resolves.toBe(
      true,
    );

    const organization = await prisma.organization.findUnique({
      where: { userId: user.id },
    });
    expect(organization).toBeNull();
  });

  it("should register an organizer with an organization", async () => {
    // Arrange
    const payload = buildRegisterPayload({
      name: "Organization Owner",
      role: Role.ORGANIZER,
      organizationName: "Acme Events",
    });

    // Act
    const response = await request(app)
      .post("/api/auth/register")
      .send(payload);

    // Assert
    expect(response.status).toBe(201);
    expect(response.body).toEqual({ message: "Register success" });

    const user = await prisma.user.findUniqueOrThrow({
      where: { email: payload.email },
    });
    expect(user.role).toBe(Role.ORGANIZER);

    const organization = await prisma.organization.findUniqueOrThrow({
      where: { userId: user.id },
    });
    expect(organization.name).toBe("Acme Events");
  });

  it("should use the user name as organization name when not provided", async () => {
    // Arrange
    const payload = buildRegisterPayload({
      name: "Solo Organizer",
      role: Role.ORGANIZER,
    });

    // Act
    const response = await request(app)
      .post("/api/auth/register")
      .send(payload);

    // Assert
    expect(response.status).toBe(201);

    const user = await prisma.user.findUniqueOrThrow({
      where: { email: payload.email },
    });
    const organization = await prisma.organization.findUniqueOrThrow({
      where: { userId: user.id },
    });
    expect(organization.name).toBe("Solo Organizer");
  });

  it("should register with a valid referral code and reward the referrer", async () => {
    // Arrange
    const referrer = await createReferrer();
    const payload = buildRegisterPayload({
      referralCode: referrer.referralCode,
    });
    const registeredAt = new Date();

    // Act
    const response = await request(app)
      .post("/api/auth/register")
      .send(payload);

    // Assert
    expect(response.status).toBe(201);

    const user = await prisma.user.findUniqueOrThrow({
      where: { email: payload.email },
    });
    expect(user.referredById).toBe(referrer.id);

    const points = await prisma.point.findMany({
      where: { userId: referrer.id },
    });
    expect(points).toHaveLength(1);
    expect(points[0].amount).toBe(10000);

    const coupons = await prisma.coupon.findMany({
      where: { userId: user.id },
    });
    expect(coupons).toHaveLength(1);
    expect(coupons[0].code).toMatch(/^REF-/);
    expect(coupons[0].discountValue).toBe(10000);
    expect(coupons[0].isUsed).toBe(false);

    // Rewards expire three months after registration.
    expect(points[0].expiresAt.getTime()).toBe(coupons[0].expiresAt.getTime());
    const expectedExpiry = new Date(registeredAt);
    expectedExpiry.setMonth(expectedExpiry.getMonth() + 3);
    expect(points[0].expiresAt.getTime()).toBeGreaterThanOrEqual(
      expectedExpiry.getTime(),
    );
    expect(points[0].expiresAt.getTime()).toBeLessThanOrEqual(
      expectedExpiry.getTime() + 60_000,
    );

    // Only the referrer receives points and only the new user receives a coupon.
    expect(await prisma.point.count({ where: { userId: user.id } })).toBe(0);
    expect(await prisma.coupon.count({ where: { userId: referrer.id } })).toBe(
      0,
    );
  });

  it("should return error when email is already registered", async () => {
    // Arrange
    const payload = buildRegisterPayload();

    // Act
    const firstResponse = await request(app)
      .post("/api/auth/register")
      .send(payload);
    const secondResponse = await request(app)
      .post("/api/auth/register")
      .send(payload);

    // Assert
    expect(firstResponse.status).toBe(201);
    expect(secondResponse.status).toBe(400);
    expect(secondResponse.body.message).toBe("Email already exists");
    expect(await prisma.user.count({ where: { email: payload.email } })).toBe(
      1,
    );
  });

  it("should return error when referral code is invalid", async () => {
    // Arrange
    const payload = buildRegisterPayload({
      referralCode: `INVALID-${Date.now()}`,
    });

    // Act
    const response = await request(app)
      .post("/api/auth/register")
      .send(payload);

    // Assert
    expect(response.status).toBe(400);
    expect(response.body.message).toBe("Invalid referral code");
    expect(
      await prisma.user.findUnique({ where: { email: payload.email } }),
    ).toBeNull();
  });

  it("should return error when required fields are missing", async () => {
    // Act
    const response = await request(app).post("/api/auth/register").send({});

    // Assert
    expect(response.status).toBe(400);
    expect(response.body.message).toBe(
      "name: Invalid input: expected string, received undefined, email: Invalid input: expected string, received undefined, password: Invalid input: expected string, received undefined",
    );
  });

  it("should return error when name is too short", async () => {
    // Arrange
    const payload = buildRegisterPayload({ name: "a" });

    // Act
    const response = await request(app)
      .post("/api/auth/register")
      .send(payload);

    // Assert
    expect(response.status).toBe(400);
    expect(response.body.message).toBe(
      "name: Too small: expected string to have >=2 characters",
    );
  });

  it("should return error when email format is invalid", async () => {
    // Arrange
    const payload = buildRegisterPayload({ email: "Invalid Email Format" });

    // Act
    const response = await request(app)
      .post("/api/auth/register")
      .send(payload);

    // Assert
    expect(response.status).toBe(400);
    expect(response.body.message).toBe("email: Invalid email address");
  });

  it("should return error when password is too short", async () => {
    // Arrange
    const payload = buildRegisterPayload({ password: "12345" });

    // Act
    const response = await request(app)
      .post("/api/auth/register")
      .send(payload);

    // Assert
    expect(response.status).toBe(400);
    expect(response.body.message).toBe(
      "password: Too small: expected string to have >=6 characters",
    );
  });

  it("should return error when role is invalid", async () => {
    // Arrange
    const payload = { ...buildRegisterPayload(), role: "ADMIN" };

    // Act
    const response = await request(app)
      .post("/api/auth/register")
      .send(payload);

    // Assert
    expect(response.status).toBe(400);
    expect(response.body.message).toBe(
      'role: Invalid option: expected one of "CUSTOMER"|"ORGANIZER"',
    );
  });

  it("should return error when organization name is too short", async () => {
    // Arrange
    const payload = buildRegisterPayload({
      role: Role.ORGANIZER,
      organizationName: "x",
    });

    // Act
    const response = await request(app)
      .post("/api/auth/register")
      .send(payload);

    // Assert
    expect(response.status).toBe(400);
    expect(response.body.message).toBe(
      "organizationName: Too small: expected string to have >=2 characters",
    );
  });

  it("should reject unknown fields", async () => {
    // Arrange
    const payload = { ...buildRegisterPayload(), isAdmin: true };

    // Act
    const response = await request(app)
      .post("/api/auth/register")
      .send(payload);

    // Assert
    expect(response.status).toBe(400);
    expect(response.body.message).toContain('Unrecognized key: "isAdmin"');
    expect(
      await prisma.user.findUnique({ where: { email: payload.email } }),
    ).toBeNull();
  });

  it("should accept boundary values for name and password", async () => {
    // Arrange
    const payload = buildRegisterPayload({
      name: "ab",
      password: "123456",
    });

    // Act
    const response = await request(app)
      .post("/api/auth/register")
      .send(payload);

    // Assert
    expect(response.status).toBe(201);
    expect(response.body).toEqual({ message: "Register success" });

    const user = await prisma.user.findUniqueOrThrow({
      where: { email: payload.email },
    });
    expect(user.name).toBe("ab");
    await expect(argon.verify(user.password, "123456")).resolves.toBe(true);
  });
});
