import argon from "argon2";
import jwt from "jsonwebtoken";
import request from "supertest";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { Role } from "../../../src/generated/prisma/enums.js";
import { prisma } from "../../../src/lib/prisma.js";

vi.mock("../../../src/lib/mail.js", () => ({
  sendMail: vi.fn(),
}));

import { app } from "../../../src/app.js";
import { sendMail } from "../../../src/lib/mail.js";

const BASE_URL_FE = "http://localhost:5173";
const GENERIC_MESSAGE =
  "If the email is registered, a reset link has been sent";
const RESET_SUBJECT = "Reset Password Request";

type TestUserOverrides = {
  name?: string;
  email?: string;
  password?: string;
  role?: Role;
};

type SentMail = {
  to: string;
  subject: string;
  templateName: string;
  context: { linkReset?: string };
};

let userSequence = 0;

async function createUser(overrides: TestUserOverrides = {}) {
  userSequence += 1;

  const password = overrides.password ?? "Test123!";
  const user = await prisma.user.create({
    data: {
      name: overrides.name ?? "test",
      email: overrides.email ?? `forgot-${Date.now()}-${userSequence}@mail.com`,
      password: await argon.hash(password),
      role: overrides.role ?? Role.CUSTOMER,
      referralCode: `RESET${Date.now()}${userSequence}`,
    },
  });

  return { user, password };
}

function getSentMail(): SentMail {
  const calls = vi.mocked(sendMail).mock.calls;
  expect(calls).toHaveLength(1);
  return calls[0][0] as SentMail;
}

function getSentResetToken(): string {
  const { context } = getSentMail();
  expect(context.linkReset).toBeDefined();

  const link = new URL(context.linkReset!);
  expect(link.origin).toBe(BASE_URL_FE);
  expect(link.pathname).toBe("/reset-password");

  const token = link.searchParams.get("token");
  expect(token).toBeTruthy();
  return token!;
}

async function forgotPassword(email: unknown) {
  return request(app).post("/api/auth/forgot-password").send({ email });
}

describe("POST /auth/forgot-password", () => {
  beforeAll(() => {
    vi.stubEnv("BASE_URL_FE", BASE_URL_FE);
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterAll(() => {
    vi.unstubAllEnvs();
  });

  it("should send a reset link to a registered user", async () => {
    // Arrange
    const { user } = await createUser({
      name: "Reset User",
      role: Role.ORGANIZER,
    });

    // Act
    const response = await forgotPassword(user.email);

    // Assert
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ message: GENERIC_MESSAGE });

    const mail = getSentMail();
    expect(mail.to).toBe(user.email);
    expect(mail.subject).toBe(RESET_SUBJECT);
    expect(mail.templateName).toBe("reset-password.hbs");
    expect(mail.context.linkReset).toContain("/reset-password?token=");
    expect(getSentResetToken()).toBeTruthy();
  });

  it("should issue a reset token for the user that expires in 15 minutes", async () => {
    // Arrange
    const { user } = await createUser({ role: Role.ORGANIZER });

    // Act
    await forgotPassword(user.email);

    // Assert
    const token = getSentResetToken();
    const payload = jwt.verify(
      token,
      process.env.JWT_SECRET_RESET!,
    ) as jwt.JwtPayload & { id: number; role: Role };

    expect(payload.id).toBe(user.id);
    expect(payload.role).toBe(Role.ORGANIZER);
    expect(payload.exp! - payload.iat!).toBe(15 * 60);
  });

  it("should not send an email when the email is not registered", async () => {
    // Act
    const response = await forgotPassword(`missing-${Date.now()}@mail.com`);

    // Assert
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ message: GENERIC_MESSAGE });
    expect(sendMail).not.toHaveBeenCalled();
  });

  it("should return an identical response whether or not the email is registered", async () => {
    // Arrange
    const { user } = await createUser();

    // Act
    const registeredResponse = await forgotPassword(user.email);
    const unregisteredResponse = await forgotPassword(
      `missing-${Date.now()}@mail.com`,
    );

    // Assert
    expect(registeredResponse.status).toBe(unregisteredResponse.status);
    expect(registeredResponse.body).toEqual(unregisteredResponse.body);
    expect(registeredResponse.body).toEqual({ message: GENERIC_MESSAGE });
    expect(registeredResponse.body).not.toHaveProperty("token");
    expect(sendMail).toHaveBeenCalledTimes(1);
  });

  it("should ignore extra fields and only email the requested recipient", async () => {
    // Arrange
    const { user } = await createUser();

    // Act
    const response = await request(app)
      .post("/api/auth/forgot-password")
      .send({
        email: user.email,
        to: "attacker@mail.com",
        role: Role.ORGANIZER,
      });

    // Assert
    expect(response.status).toBe(200);
    expect(getSentMail().to).toBe(user.email);
  });

  const invalidEmailPayloads: Array<
    [string, Record<string, unknown>, string]
  > = [
    [
      "missing",
      {},
      "email: Invalid input: expected string, received undefined",
    ],
    ["empty", { email: "" }, "email: Invalid email address"],
    ["malformed", { email: "not-an-email" }, "email: Invalid email address"],
    [
      "null",
      { email: null },
      "email: Invalid input: expected string, received null",
    ],
    [
      "non-string",
      { email: 123 },
      "email: Invalid input: expected string, received number",
    ],
  ];

  it.each(invalidEmailPayloads)(
    "should reject a request with a %s email",
    async (_case, payload, expectedMessage) => {
      // Act
      const response = await request(app)
        .post("/api/auth/forgot-password")
        .send(payload);

      // Assert
      expect(response.status).toBe(400);
      expect(response.body.message).toBe(expectedMessage);
      expect(sendMail).not.toHaveBeenCalled();
    },
  );

  it("should allow the emailed token to reset the user's password", async () => {
    // Arrange
    const { user, password } = await createUser();
    const newPassword = "NewTest123!";

    await forgotPassword(user.email);
    const token = getSentResetToken();

    // Act
    const response = await request(app)
      .post("/api/auth/reset-password")
      .set("Authorization", `Bearer ${token}`)
      .send({ password: newPassword });

    // Assert
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ message: "Reset password successfuly" });

    const updatedUser = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
    });
    await expect(argon.verify(updatedUser.password, newPassword)).resolves.toBe(
      true,
    );
    await expect(argon.verify(updatedUser.password, password)).resolves.toBe(
      false,
    );

    const loginResponse = await request(app).post("/api/auth/login").send({
      email: user.email,
      password: newPassword,
    });
    expect(loginResponse.status).toBe(200);
    expect(loginResponse.body.user.id).toBe(user.id);
  });

  it("should not accept a reset token as a login token", async () => {
    // Arrange
    const { user } = await createUser();
    await forgotPassword(user.email);
    const token = getSentResetToken();

    // Act
    const response = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${token}`);

    // Assert
    expect(response.status).toBe(401);
    expect(response.body.message).toBe("Invalid token");
  });

  it("should not accept a login token for resetting the password", async () => {
    // Arrange
    const { user, password } = await createUser();
    const loginResponse = await request(app).post("/api/auth/login").send({
      email: user.email,
      password,
    });

    // Act
    const response = await request(app)
      .post("/api/auth/reset-password")
      .set("Authorization", `Bearer ${loginResponse.body.accessToken}`)
      .send({ password: "NewTest123!" });

    // Assert
    expect(response.status).toBe(401);
    expect(response.body.message).toBe("Invalid token");
    await expect(
      argon.verify(
        (await prisma.user.findUniqueOrThrow({ where: { id: user.id } }))
          .password,
        password,
      ),
    ).resolves.toBe(true);
  });
});
