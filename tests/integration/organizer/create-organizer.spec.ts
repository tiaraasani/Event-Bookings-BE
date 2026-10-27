import argon from "argon2";
import jwt from "jsonwebtoken";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { Role } from "../../../src/generated/prisma/enums.js";
import { prisma } from "../../../src/lib/prisma.js";
import { app } from "../../../src/app.js";

type TestUserOverrides = {
  name?: string;
  email?: string;
  password?: string;
  role?: Role;
  organizationName?: string;
};

let sequence = 0;

function buildRegisterPayload(overrides: TestUserOverrides = {}) {
  sequence += 1;

  return {
    name: overrides.name ?? "Organization Owner",
    email: overrides.email ?? `organizer-${Date.now()}-${sequence}@mail.com`,
    password: overrides.password ?? "Test123!",
    role: overrides.role ?? Role.ORGANIZER,
    ...(overrides.organizationName !== undefined && {
      organizationName: overrides.organizationName,
    }),
  };
}

async function createUser(overrides: TestUserOverrides = {}) {
  sequence += 1;

  return prisma.user.create({
    data: {
      name: overrides.name ?? "Test User",
      email: overrides.email ?? `user-${Date.now()}-${sequence}@mail.com`,
      password: await argon.hash(overrides.password ?? "Test123!"),
      role: overrides.role ?? Role.CUSTOMER,
      referralCode: `USER${Date.now()}${sequence}`,
    },
  });
}

function register(payload: ReturnType<typeof buildRegisterPayload>) {
  return request(app).post("/api/auth/register").send(payload);
}

function login(email: string, password: string) {
  return request(app).post("/api/auth/login").send({ email, password });
}

function getMyOrganization(token?: string) {
  const req = request(app).get("/api/organizer/organization");

  if (token !== undefined) {
    req.set("Authorization", `Bearer ${token}`);
  }

  return req;
}

function signAccessToken(
  user: { id: number; role: Role },
  options: jwt.SignOptions = {},
) {
  return jwt.sign({ id: user.id, role: user.role }, process.env.JWT_SECRET!, {
    expiresIn: "1h",
    ...options,
  });
}

describe("Organizer creation", () => {
  it("should register an organizer with an organization and expose it through the organizer endpoint", async () => {
    // Arrange
    const payload = buildRegisterPayload({
      name: "Organization Owner",
      organizationName: "Acme Events",
    });

    // Act
    const registerResponse = await register(payload);

    // Assert
    expect(registerResponse.status).toBe(201);
    expect(registerResponse.body).toEqual({ message: "Register success" });

    const user = await prisma.user.findUniqueOrThrow({
      where: { email: payload.email },
    });
    expect(user).toMatchObject({
      name: "Organization Owner",
      email: payload.email,
      role: Role.ORGANIZER,
      referredById: null,
    });
    expect(user.referralCode).toBeTruthy();
    expect(user.password).not.toBe(payload.password);
    await expect(argon.verify(user.password, payload.password)).resolves.toBe(
      true,
    );

    const organization = await prisma.organization.findUniqueOrThrow({
      where: { userId: user.id },
    });
    expect(organization).toMatchObject({
      userId: user.id,
      name: "Acme Events",
      logo: null,
      description: null,
      field: null,
    });
    expect(
      await prisma.organization.count({ where: { userId: user.id } }),
    ).toBe(1);

    const loginResponse = await login(payload.email, payload.password);
    expect(loginResponse.status).toBe(200);
    expect(loginResponse.body.accessToken).toEqual(expect.any(String));
    expect(loginResponse.body.user).toMatchObject({
      id: user.id,
      name: "Organization Owner",
      email: payload.email,
      role: Role.ORGANIZER,
    });

    const organizationResponse = await getMyOrganization(
      loginResponse.body.accessToken,
    );
    expect(organizationResponse.status).toBe(200);
    expect(organizationResponse.body).toEqual({
      id: organization.id,
      name: "Acme Events",
    });
  });

  it("should use the organizer name when organizationName is not provided", async () => {
    // Arrange
    const payload = buildRegisterPayload({ name: "Solo Organizer" });

    // Act
    const registerResponse = await register(payload);

    // Assert
    expect(registerResponse.status).toBe(201);

    const user = await prisma.user.findUniqueOrThrow({
      where: { email: payload.email },
    });
    const organization = await prisma.organization.findUniqueOrThrow({
      where: { userId: user.id },
    });
    expect(organization.name).toBe("Solo Organizer");

    const organizationResponse = await getMyOrganization(
      signAccessToken(user),
    );
    expect(organizationResponse.status).toBe(200);
    expect(organizationResponse.body).toEqual({
      id: organization.id,
      name: "Solo Organizer",
    });
  });

  it("should not create an organization for a registered customer", async () => {
    // Arrange
    const payload = buildRegisterPayload({ role: Role.CUSTOMER });

    // Act
    const response = await register(payload);

    // Assert
    expect(response.status).toBe(201);

    const user = await prisma.user.findUniqueOrThrow({
      where: { email: payload.email },
    });
    expect(user.role).toBe(Role.CUSTOMER);
    expect(
      await prisma.organization.findUnique({ where: { userId: user.id } }),
    ).toBeNull();
    expect(await prisma.organization.count()).toBe(0);
  });

  it("should not create an organizer when organizationName is too short", async () => {
    // Arrange
    const payload = buildRegisterPayload({ organizationName: "x" });

    // Act
    const response = await register(payload);

    // Assert
    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      message:
        "organizationName: Too small: expected string to have >=2 characters",
    });
    expect(
      await prisma.user.findUnique({ where: { email: payload.email } }),
    ).toBeNull();
    expect(await prisma.organization.count()).toBe(0);
  });

  it("should return 404 when the organizer has no organization", async () => {
    // Arrange
    const organizer = await createUser({ role: Role.ORGANIZER });

    // Act
    const response = await getMyOrganization(signAccessToken(organizer));

    // Assert
    expect(response.status).toBe(404);
    expect(response.body).toEqual({ message: "Organization not found" });
  });

  it("should return 403 when a customer requests the organizer organization", async () => {
    // Arrange
    const customer = await createUser({ role: Role.CUSTOMER });

    // Act
    const response = await getMyOrganization(signAccessToken(customer));

    // Assert
    expect(response.status).toBe(403);
    expect(response.body).toEqual({ message: "Forbidden" });
  });

  it("should return 401 when no token is provided", async () => {
    // Act
    const response = await getMyOrganization();

    // Assert
    expect(response.status).toBe(401);
    expect(response.body).toEqual({ message: "Token not provided" });
  });

  it("should return 401 for an invalid token", async () => {
    // Act
    const response = await getMyOrganization("not-a-real-token");

    // Assert
    expect(response.status).toBe(401);
    expect(response.body).toEqual({ message: "Invalid token" });
  });

  it("should return 401 for an expired token", async () => {
    // Arrange
    const organizer = await createUser({ role: Role.ORGANIZER });
    const token = signAccessToken(organizer, { expiresIn: -10 });

    // Act
    const response = await getMyOrganization(token);

    // Assert
    expect(response.status).toBe(401);
    expect(response.body).toEqual({ message: "Token expired" });
  });
});
