import { ZodError, ZodType } from "zod";
import { ApiError } from "../utils/api-error";
import { Request, Response, NextFunction } from "express";

export const validate = (schema: ZodType) => {
  return (req: Request, _res: Response, next: NextFunction) => {
    try {
      req.body = schema.parse(req.body);
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        const message = error.issues
          .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
          .join(", ");
        return next(new ApiError(message, 400));
      }
      next(error);
    }
  };
};
