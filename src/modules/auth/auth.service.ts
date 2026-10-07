import argon2 from "argon2";
import { prisma } from "../../lib/prisma";
import { LoginInput, RegisterInput } from "./auth.validation";
import jwt from "jsonwebtoken";
import { ApiError } from "../../utils/api-error";

function generateReferralCode() {
  return Math.random().toString(36).substring(2, 10).toUpperCase();
}

const REFERRAL_POINTS = 10000;
const COUPON_VALUE = 10000;
const REWARD_VALID_MONTHS = 3;

function addMonths(date: Date, months: number): Date {
  const result = new Date(date);
  result.setMonth(result.getMonth() + months);
  return result;
}

export async function register(input: RegisterInput) {
  const existing = await prisma.user.findUnique({
    where: { email: input.email },
  });
  if (existing) {
    throw new ApiError("Email already exists", 400);
  }

  let referredById: number | null = null;
  if (input.referralCode) {
    const referrer = await prisma.user.findUnique({
      where: { referralCode: input.referralCode },
    });
    if (!referrer) {
      throw new ApiError("Invalid referral code", 400);
    }
    referredById = referrer.id;
  }
  const hashedPassword = await argon2.hash(input.password);

  await prisma.$transaction(async (tx) => {
    const newUser = await tx.user.create({
      data: {
        name: input.name,
        email: input.email,
        password: hashedPassword,
        role: input.role || "CUSTOMER",
        referralCode: generateReferralCode(),
        referredById: referredById,
      },
    });

    if (newUser.role == "ORGANIZER") {
      await tx.organization.create({
        data: {
          userId: newUser.id,
          name: input.organizationName || input.name,
        },
      });
    }

    if (referredById) {
      const expiresAt = addMonths(new Date(), REWARD_VALID_MONTHS);

      await tx.point.create({
        data: {
          userId: referredById,
          amount: REFERRAL_POINTS,
          expiresAt: expiresAt,
        },
      });

      await tx.coupon.create({
        data: {
          userId: newUser.id,
          code: "REF-" + generateReferralCode(),
          discountValue: COUPON_VALUE,
          expiresAt: expiresAt,
        },
      });
    }
  });

  return { message: "Register success" };
}

export async function login(input: LoginInput) {
  const user = await prisma.user.findUnique({
    where: { email: input.email },
  });
  if (!user) {
    throw new ApiError("Invalid email or password", 400);
  }

  const valid = await argon2.verify(user.password, input.password);
  if (!valid) {
    throw new ApiError("Invalid email or password", 400);
  }

  const token = jwt.sign(
    { id: user.id, role: user.role },
    process.env.JWT_SECRET!,
    { expiresIn: "1h" },
  );

  return {
    message: "Login success",
    accessToken: token,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      picture: user.picture,
      referralCode: user.referralCode,
    },
  };
}
