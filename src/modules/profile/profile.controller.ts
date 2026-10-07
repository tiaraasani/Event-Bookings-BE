import * as profileService from "./profile.service";
import { Request, Response } from "express";


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
