import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { Role } from "../generated/prisma/client";
import { ApiError } from "../utils/api-error";

export interface JwtPayload {
  id: number;
  role: Role;
}

declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

export function verifyToken(secretName: "JWT_SECRET" | "JWT_SECRET_RESET") {
  return (req: Request, res: Response, next: NextFunction) => {
    const token = req.headers.authorization?.split(" ")[1];
    if (!token) {
      return next(new ApiError("Token not provided", 401));
    }

    try {
      const payload = jwt.verify(token, process.env[secretName]!) as JwtPayload;
      req.user = payload;
      next();
    } catch (error) {
      if (error instanceof jwt.TokenExpiredError) {
        return next(new ApiError("Token expired", 401));
      }
      return next(new ApiError("Invalid token", 401));
    }
  };
}

export const authenticate = verifyToken("JWT_SECRET");

export function authorize(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return next(new ApiError("Forbidden", 403));
    }
    next();
  };
}
