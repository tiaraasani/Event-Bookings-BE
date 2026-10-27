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
};

type TestOrganizationOverrides = {
  name?: string;
  logo?: string | null;
  description?: string | null;
  field?: string | null;
};

type TestOrganizerOverrides = {
  user?: TestUserOverrides;
  organization?: TestOrganizationOverrides | null;
};

let sequence = 0;

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

async function createOrganizer(overrides: TestOrganizerOverrides = {}) {
  const user = await createUser({
    name: "Organization Owner",
    role: Role.ORGANIZER,
    ...overrides.user,
  });

  if (overrides.organization === null) {
    return { user, organization: null };
  }

  const organization = await prisma.organization.create({
    data: {
      userId: user.id,
      name: overrides.organization?.name ?? "Acme Events",
      logo: overrides.organization?.logo ?? null,
      description: overrides.organization?.description ?? null,
      field: overrides.organization?.field ?? null,
    },
  });

  return { user, organization };
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

function getMyOrganization(token?: string) {
  const req = request(app).get("/api/organizer/organization");

  if (token !== undefined) {
    req.set("Authorization", `Bearer ${token}`);
  }

  return req;
}

describe("GET /organizer/organization", () => {
  it("should return the authenticated organizer's organization", async () => {
    // Arrange
    const { user, organization } = await createOrganizer({
      organization: { name: "Acme Events" },
    });

    // Act
    const response = await getMyOrganization(signAccessToken(user));

    // Assert
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      id: organization!.id,
      name: "Acme Events",
    });
  });

  it("should only return the organization that belongs to the authenticated organizer", async () => {
    // Arrange
    const organizer = await createOrganizer({
      organization: { name: "My Events" },
    });
    const otherOrganizer = await createOrganizer({
      organization: { name: "Other Events" },
    });

    // Act
    const response = await getMyOrganization(signAccessToken(organizer.user));
    const otherResponse = await getMyOrganization(
      signAccessToken(otherOrganizer.user),
    );

    // Assert
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      id: organizer.organization!.id,
      name: "My Events",
    });

    expect(otherResponse.status).toBe(200);
    expect(otherResponse.body).toEqual({
      id: otherOrganizer.organization!.id,
      name: "Other Events",
    });
  });

  it("should not expose private organization fields or the owner's credentials", async () => {
    // Arrange
    const { user } = await createOrganizer({
      user: { name: "Private Owner" },
      organization: {
        name: "Acme Events",
        logo: "https://res.cloudinary.com/demo/image/upload/logo.png",
        description: "A private description",
        field: "Music",
      },
    });

    // Act
    const response = await getMyOrganization(signAccessToken(user));

    // Assert
    expect(response.status).toBe(200);
    expect(Object.keys(response.body).sort()).toEqual(["id", "name"]);
    expect(response.body).not.toHaveProperty("userId");
    expect(response.body).not.toHaveProperty("logo");
    expect(response.body).not.toHaveProperty("description");
    expect(response.body).not.toHaveProperty("field");
    expect(JSON.stringify(response.body)).not.toContain("password");
  });

  it("should work with a token obtained from the login endpoint", async () => {
    // Arrange
    const { user, organization } = await createOrganizer({
      user: { password: "Test123!" },
      organization: { name: "Login Session Events" },
    });

    const loginResponse = await request(app).post("/api/auth/login").send({
      email: user.email,
      password: "Test123!",
    });

    // Act
    const response = await getMyOrganization(loginResponse.body.accessToken);

    // Assert
    expect(loginResponse.status).toBe(200);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      id: organization!.id,
      name: "Login Session Events",
    });
  });

  it("should return 404 when the organizer has no organization", async () => {
    // Arrange
    const { user } = await createOrganizer({ organization: null });

    // Act
    const response = await getMyOrganization(signAccessToken(user));

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

  it("should return 401 when the authorization header lacks the Bearer scheme", async () => {
    // Arrange
    const { user } = await createOrganizer();

    // Act
    const response = await request(app)
      .get("/api/organizer/organization")
      .set("Authorization", signAccessToken(user));

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
    const { user } = await createOrganizer();
    const token = signAccessToken(user, { expiresIn: -10 });

    // Act
    const response = await getMyOrganization(token);

    // Assert
    expect(response.status).toBe(401);
    expect(response.body).toEqual({ message: "Token expired" });
  });
});
