import { prisma } from "../../lib/prisma";
import { UpdateProfileInput, ChangePasswordInput } from "./profile.validation";
import argon2 from "argon2";

export async function getProfile(userId: number) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      organization: true,
    },
  });
  if (!user) {
    throw new Error("User not found");
  }

  const now = new Date();
  
  //gt mksdnya greater than (ambil point yg blm expired)
  const pointSum = await prisma.point.aggregate({
    where: {
      userId: userId,
      expiresAt: {
        gt: now,
      },
    },
    _sum: { amount: true },
  });

  const coupons = await prisma.coupon.findMany({
    where: {
      userId: userId,
      isUsed: false,
      expiresAt: {
        gt: now,
      },
    },
    orderBy: {
      expiresAt: "asc",
    },
  });

  const { password, ...safeUser } = user;
  return {
    ...safeUser,
    pointBalance: pointSum._sum.amount || 0,
    coupons: coupons,
  };
}

export async function updateProfile(userId: number, input: UpdateProfileInput) {
  const user = await prisma.user.update({
    where: { id: userId },
    data: {
      name: input.name,
    },
  });

  const { password, ...safeUser } = user;
  return safeUser;
}

export async function changePassword(
  userId: number,
  input: ChangePasswordInput,
) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
  });
  if (!user) {
    throw new Error("User not found");
  }

  const valid = await argon2.verify(user.password, input.currentPassword);
  if (!valid) {
    throw new Error("Current password is incorrect");
  }

  const hashedPassword = await argon2.hash(input.newPassword);
  await prisma.user.update({
    where: { id: userId },
    data: {
      password: hashedPassword,
    },
  });
}
