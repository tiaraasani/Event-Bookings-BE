import * as profileService from "./profile.service";
import { Request, Response } from "express";
import { ApiError } from "../../utils/api-error";

export async function getProfile(req: Request, res: Response) {
  const result = await profileService.getProfile(req.user!.id);
  res.status(200).json(result);
}

export async function updateProfile(req: Request, res: Response) {
  const result = await profileService.updateProfile(req.user!.id, req.body);
  res.status(200).json(result);
}

export async function changePassword(req: Request, res: Response) {
  const result = await profileService.changePassword(req.user!.id, req.body);
  res.status(200).json(result);
}
export async function updatePicture(req: Request, res: Response) {
  const files = req.files as { [fieldname: string]: Express.Multer.File[] };
  const picture = files?.picture?.[0];

  if (!picture) {
    throw new ApiError("Picture file is required", 400);
  }

  const result = await profileService.updatePicture(req.user!.id, picture);
  res.status(200).json(result);
}
