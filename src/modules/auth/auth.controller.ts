import { Request, Response } from "express";
import { loginSchema, registerSchema } from "./auth.validation";
import * as authService from "./auth.service";

export async function register(req: Request, res: Response) {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      message: "validation error",
      errors: parsed.error.issues,
    });
  }

  try {
    const user = await authService.register(parsed.data);
    return res.status(201).json({
      message: "User registered successfully",
      data: user,
    });
  } catch (err) {
    return res.status(400).json({ message: (err as Error).message });
  }
}

export async function login(req: Request, res: Response) {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(401).json({
      message: "Invalid login credentials",
      errors: parsed.error.issues,
    });
  }

  try {
    const result = await authService.login(parsed.data);
    return res.status(200).json({
      message: "Login successful",
      data: result,
    });
  } catch (err) {
    return res.status(400).json({ message: (err as Error).message });
  }
}

//untuk mengecek siapa yang punya token
export async function me(req: Request, res: Response) {
  return res.status(200).json({
    message: "User info retrieved successfully",
    data: req.user,
  });
}
