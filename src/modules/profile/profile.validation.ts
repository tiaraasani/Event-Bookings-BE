import { z } from "zod";

export const updateProfileSchema = z.strictObject({
  name: z.string().min(2),
});

export const changePasswordSchema = z.strictObject({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(6),
});

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;