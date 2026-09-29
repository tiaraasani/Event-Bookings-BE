import { prisma } from "../../lib/prisma";
import { LoginInput, RegisterInput } from "./auth.validation";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";

function generateReferralCode() {
  return Math.random().toString(36).substring(2, 10).toUpperCase();
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
  const hashedPassword = await bcrypt.hash(input.password, 10);

  const user = await prisma.user.create({
    data: {
      name: input.name,
      email: input.email,
      password: hashedPassword,
      role: input.role || "CUSTOMER",
      referralCode: generateReferralCode(),
      referredById: referredById,
    },
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

  const valid = await bcrypt.compare(input.password, user.password);
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
