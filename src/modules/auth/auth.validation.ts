import { z } from "zod";

export const registerSchema = z.strictObject({
  name: z.string().min(2),
  email: z.email(),
  password: z.string().min(6),
  role: z.enum(["CUSTOMER", "ORGANIZER"]).optional(),
  referralCode: z.string().optional(),
  organizationName: z.string().min(2).optional(),
});

export const loginSchema = z.object({
  email: z.email(),
  password: z.string().min(1),
});

export const forgotPasswordSchema = z.object({
  email: z.email(),
});

export const resetPasswordSchema = z.object({
  password: z.string().min(6),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
