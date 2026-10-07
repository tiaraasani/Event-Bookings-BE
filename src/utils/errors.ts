import type { ApiError } from "./api-error";
import { Request, Response, NextFunction } from "express";



export const globalError = (
    err: ApiError,
    _req: Request,
    res: Response,
    _next: NextFunction,
) => {
    const status = err.status || 500;
    const message = err.message || "something went wrong";

    if (!err.status) console.error(err);

    res.status(status).json({ message });
};

export const notFoundError = (_req: Request, res: Response) => {
    res.status(404).json({ message: "Route not found" });
};