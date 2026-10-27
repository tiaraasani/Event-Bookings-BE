import argon from "argon2";
import jwt from "jsonwebtoken";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { Role } from "../../../src/generated/prisma/enums.js";
import { prisma } from "../../../src/lib/prisma.js";
import { app } from "../../../src/app.js";

const SUCCESS_MESSAGE = "Reset password successfuly";

type TestUserOverrides = {
  name?: string;
  email?: string;
  password?: string;
  role?: Role;
  picture?: string | null;
};

type ResetTokenPayload = {
  id: number;
  role: Role;
};

let userSequence = 0;

async function createUser(overrides: TestUserOverrides = {}) {
  userSequence += 1;

  const password = overrides.password ?? "Test123!";
  const user = await prisma.user.create({
    data: {
      name: overrides.name ?? "test",
      email: overrides.email ?? `reset-${Date.now()}-${userSequence}@mail.com`,
      password: await argon.hash(password),
      role: overrides.role ?? Role.CUSTOMER,
      referralCode: `RESETPWD${Date.now()}${userSequence}`,
      picture: overrides.picture ?? null,
    },
  });

  return { user, password };
}

function signResetToken(
  payload: ResetTokenPayload,
  options: jwt.SignOptions = {},
) {
  return jwt.sign(payload, process.env.JWT_SECRET_RESET!, {
    expiresIn: "15m",
    ...options,
  });
}

async function resetPassword(token: string | undefined, payload: object) {
  const req = request(app).post("/api/auth/reset-password");

  if (token !== undefined) {
    req.set("Authorization", `Bearer ${token}`);
  }

  return req.send(payload);
}

describe("POST /auth/reset-password", () => {
  it("should reset the password with a valid reset token", async () => {
    // Arrange
    const { user, password } = await createUser();
    const newPassword = "NewTest123!";
    const token = signResetToken({ id: user.id, role: user.role });

    // Act
    const response = await resetPassword(token, { password: newPassword });

    // Assert
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ message: SUCCESS_MESSAGE });

    const updatedUser = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
    });
    expect(updatedUser.password).not.toBe(newPassword);
    await expect(argon.verify(updatedUser.password, newPassword)).resolves.toBe(
      true,
    );
    await expect(argon.verify(updatedUser.password, password)).resolves.toBe(
      false,
    );
  });

  it("should allow login with the new password and reject the old password", async () => {
    // Arrange
    const { user, password } = await createUser();
    const newPassword = "BrandNew123!";
    const token = signResetToken({ id: user.id, role: user.role });
    await resetPassword(token, { password: newPassword });

    // Act
    const newPasswordResponse = await request(app)
      .post("/api/auth/login")
      .send({ email: user.email, password: newPassword });
    const oldPasswordResponse = await request(app)
      .post("/api/auth/login")
      .send({ email: user.email, password });

    // Assert
    expect(newPasswordResponse.status).toBe(200);
    expect(newPasswordResponse.body.user.id).toBe(user.id);

    expect(oldPasswordResponse.status).toBe(400);
    expect(oldPasswordResponse.body.message).toBe("Invalid email or password");
  });

  it("should only change the password and keep the rest of the profile intact", async () => {
    // Arrange
    const { user } = await createUser({
      name: "Organizer User",
      role: Role.ORGANIZER,
      picture: "https://example.com/avatar.png",
    });
    await prisma.organization.create({
      data: { userId: user.id, name: "Acme Events" },
    });
    const token = signResetToken({ id: user.id, role: user.role });

    // Act
    const response = await resetPassword(token, {
      password: "AnotherPass123!",
    });

    // Assert
    expect(response.status).toBe(200);

    const updatedUser = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
    });
    expect(updatedUser).toMatchObject({
      name: user.name,
      email: user.email,
      role: user.role,
      picture: user.picture,
      referralCode: user.referralCode,
      referredById: user.referredById,
    });

    const organization = await prisma.organization.findUniqueOrThrow({
      where: { userId: user.id },
    });
    expect(organization.name).toBe("Acme Events");
  });

  it("should reject a request without a token", async () => {
    // Arrange
    const { user, password } = await createUser();

    // Act
    const response = await resetPassword(undefined, {
      password: "NewTest123!",
    });

    // Assert
    expect(response.status).toBe(401);
    expect(response.body.message).toBe("Token not provided");

    const unchangedUser = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
    });
    await expect(argon.verify(unchangedUser.password, password)).resolves.toBe(
      true,
    );
  });

  it("should reject an authorization header without the Bearer scheme", async () => {
    // Arrange
    const { user } = await createUser();
    const token = signResetToken({ id: user.id, role: user.role });

    // Act
    const response = await request(app)
      .post("/api/auth/reset-password")
      .set("Authorization", token)
      .send({ password: "NewTest123!" });

    // Assert
    expect(response.status).toBe(401);
    expect(response.body.message).toBe("Token not provided");
  });

  it("should reject a malformed token", async () => {
    // Act
    const response = await resetPassword("not-a-real-token", {
      password: "NewTest123!",
    });

    // Assert
    expect(response.status).toBe(401);
    expect(response.body.message).toBe("Invalid token");
  });

  it("should reject an expired reset token", async () => {
    // Arrange
    const { user, password } = await createUser();
    const token = signResetToken(
      { id: user.id, role: user.role },
      { expiresIn: -10 },
    );

    // Act
    const response = await resetPassword(token, { password: "NewTest123!" });

    // Assert
    expect(response.status).toBe(401);
    expect(response.body.message).toBe("Token expired");

    const unchangedUser = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
    });
    await expect(argon.verify(unchangedUser.password, password)).resolves.toBe(
      true,
    );
  });

  it("should reject a login token", async () => {
    // Arrange
    const { user, password } = await createUser();
    const loginResponse = await request(app)
      .post("/api/auth/login")
      .send({ email: user.email, password });

    // Act
    const response = await resetPassword(loginResponse.body.accessToken, {
      password: "NewTest123!",
    });

    // Assert
    expect(response.status).toBe(401);
    expect(response.body.message).toBe("Invalid token");

    const unchangedUser = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
    });
    await expect(argon.verify(unchangedUser.password, password)).resolves.toBe(
      true,
    );
  });

  it("should reject a token signed with the wrong secret", async () => {
    // Arrange
    const { user } = await createUser();
    const token = jwt.sign(
      { id: user.id, role: user.role },
      "definitely-the-wrong-secret",
      { expiresIn: "15m" },
    );

    // Act
    const response = await resetPassword(token, { password: "NewTest123!" });

    // Assert
    expect(response.status).toBe(401);
    expect(response.body.message).toBe("Invalid token");
  });

  it("should return not found when the token belongs to a non-existent user", async () => {
    // Arrange
    const token = signResetToken({ id: 999_999_999, role: Role.CUSTOMER });

    // Act
    const response = await resetPassword(token, { password: "NewTest123!" });

    // Assert
    expect(response.status).toBe(404);
    expect(response.body.message).toBe("User not found");
  });

  it("should only update the user referenced by the token", async () => {
    // Arrange
    const { user: target, password: targetPassword } = await createUser();
    const { user: other, password: otherPassword } = await createUser();
    const token = signResetToken({ id: target.id, role: target.role });
    const newPassword = "TargetNew123!";

    // Act
    const response = await resetPassword(token, {
      password: newPassword,
      id: other.id,
      email: other.email,
      role: Role.ORGANIZER,
    });

    // Assert
    expect(response.status).toBe(200);

    const updatedTarget = await prisma.user.findUniqueOrThrow({
      where: { id: target.id },
    });
    await expect(
      argon.verify(updatedTarget.password, newPassword),
    ).resolves.toBe(true);
    await expect(
      argon.verify(updatedTarget.password, targetPassword),
    ).resolves.toBe(false);
    expect(updatedTarget.role).toBe(target.role);

    const untouchedOther = await prisma.user.findUniqueOrThrow({
      where: { id: other.id },
    });
    expect(untouchedOther.password).toBe(other.password);
    await expect(
      argon.verify(untouchedOther.password, otherPassword),
    ).resolves.toBe(true);
    expect(untouchedOther.role).toBe(other.role);
  });

  it("should accept a password with exactly six characters", async () => {
    // Arrange
    const { user } = await createUser();
    const token = signResetToken({ id: user.id, role: user.role });

    // Act
    const response = await resetPassword(token, { password: "123456" });

    // Assert
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ message: SUCCESS_MESSAGE });

    const updatedUser = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
    });
    await expect(argon.verify(updatedUser.password, "123456")).resolves.toBe(
      true,
    );
  });

  const invalidPasswordPayloads: Array<
    [string, Record<string, unknown>, string]
  > = [
    [
      "missing",
      {},
      "password: Invalid input: expected string, received undefined",
    ],
    [
      "empty",
      { password: "" },
      "password: Too small: expected string to have >=6 characters",
    ],
    [
      "too short",
      { password: "12345" },
      "password: Too small: expected string to have >=6 characters",
    ],
    [
      "null",
      { password: null },
      "password: Invalid input: expected string, received null",
    ],
    [
      "non-string",
      { password: 123456 },
      "password: Invalid input: expected string, received number",
    ],
  ];

  it.each(invalidPasswordPayloads)(
    "should reject a %s password",
    async (_case, payload, expectedMessage) => {
      // Arrange
      const { user } = await createUser();
      const token = signResetToken({ id: user.id, role: user.role });

      // Act
      const response = await resetPassword(token, payload);

      // Assert
      expect(response.status).toBe(400);
      expect(response.body.message).toBe(expectedMessage);

      const unchangedUser = await prisma.user.findUniqueOrThrow({
        where: { id: user.id },
      });
      expect(unchangedUser.password).toBe(user.password);
    },
  );

  it("should check the token before validating the password", async () => {
    // Act
    const noTokenResponse = await resetPassword(undefined, {});
    const invalidTokenResponse = await resetPassword("not-a-real-token", {});

    // Assert
    expect(noTokenResponse.status).toBe(401);
    expect(noTokenResponse.body.message).toBe("Token not provided");
    expect(invalidTokenResponse.status).toBe(401);
    expect(invalidTokenResponse.body.message).toBe("Invalid token");
  });
});
