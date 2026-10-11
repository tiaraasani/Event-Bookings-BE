import { Request, Response } from "express";
import * as authService from "./auth.service";

export async function register(req: Request, res: Response) {
  const result = await authService.register(req.body);
  res.status(201).json(result);
}

export async function login(req: Request, res: Response) {
  const result = await authService.login(req.body);
  res.status(200).json(result);
}

//untuk ngecek siapa yang punya token
export async function me(req: Request, res: Response) {
  res.status(200).json(req.user);
}

export async function forgotPassword(req: Request, res: Response) {
  const result = await authService.forgotPassword(req.body);
  res.status(200).json(result);
}
export async function resetPassword(req: Request, res: Response) {
  const result = await authService.resetPassword(req.body, req.user!.id);
  res.status(200).json(result);
}
