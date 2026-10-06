import argon2 from "argon2";
import { prisma } from "../../lib/prisma";
import { LoginInput, RegisterInput } from "./auth.validation";
import jwt from "jsonwebtoken";

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
    throw new Error("Email already exists");
  }

  let referredById: number | null = null;
  if (input.referralCode) {
    const referrer = await prisma.user.findUnique({
      where: { referralCode: input.referralCode },
    });
    if (!referrer) {
      throw new Error("Invalid referral code");
    }
    referredById = referrer.id;
  }
  const hashedPassword = await argon2.hash(input.password);

  // const user = await prisma.user.create({
  //   data: {
  //     name: input.name,
  //     email: input.email,
  //     password: hashedPassword,
  //     role: input.role || "CUSTOMER",
  //     referralCode: generateReferralCode(),
  //     referredById: referredById,
  //   },
  // });

  const user = await prisma.$transaction(async (tx) => {
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
    return newUser;
  });

  const { password, ...safeUser } = user;
  return safeUser;
}

export async function login(input: LoginInput) {
  const user = await prisma.user.findUnique({
    where: { email: input.email },
  });
  if (!user) {
    throw new Error("Invalid email or password");
  }

  const valid = await argon2.verify(user.password, input.password);
  if (!valid) {
    throw new Error("Invalid email or password");
  }

  const token = jwt.sign(
    { id: user.id, role: user.role },
    process.env.JWT_SECRET!,
    { expiresIn: "1h" },
  );

  const { password, ...safeUser } = user;
  return { user: safeUser, token };
}
