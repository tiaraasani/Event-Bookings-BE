import * as profileService from "./profile.service";
import { Request, Response } from "express";
import {
  changePasswordSchema,
  updateProfileSchema,
} from "./profile.validation";

export async function getProfile(req: Request, res: Response) {
  try {
    const profile = await profileService.getProfile(req.user!.id);
    return res.status(200).json({
      data: profile,
    });
  } catch (err) {
    return res.status(400).json({ message: (err as Error).message });
  }
}

export async function updateProfile(req: Request, res: Response) {
  const parsed = updateProfileSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      message: "validation error",
      errors: parsed.error.issues,
    });
  }

  try {
    const user = await profileService.updateProfile(req.user!.id, parsed.data);
    return res.status(200).json({
      message: "Profile Updated",
      data: user,
    });
  } catch (err) {
    return res.status(400).json({ message: (err as Error).message });
  }
}

export async function changePassword(req: Request, res: Response) {
  const parsed = changePasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      message: "validation error",
      errors: parsed.error.issues,
    });
  }

  try {
    await profileService.changePassword(req.user!.id, parsed.data);
    return res.status(200).json({
      message: "Password Changed",
    });
  } catch (err) {
    return res.status(400).json({ message: (err as Error).message });
  }
}
