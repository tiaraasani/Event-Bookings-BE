import type { NextFunction, Request, Response } from "express";
import {
  createTransactionService,
  getMyTransactionsService,
  uploadPaymentProofService,
} from "./transaction.service.js";

export const createTransactionController = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const result = await createTransactionService(req.user!.id, req.body);

    res.status(201).json({
      message: "Transaction created successfully",
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

export const uploadPaymentProofController = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const files = req.files as
      | { [fieldname: string]: Express.Multer.File[] }
      | undefined;

    const imageFile = files?.image?.[0];

    if (!imageFile) {
      throw new Error("Payment proof image is required");
    }

    const result = await uploadPaymentProofService(
      req.user!.id,
      Number(req.params.id),
      imageFile,
    );

    res.status(200).json({
      message: "Payment proof uploaded successfully",
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

export const getMyTransactionsController = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const result = await getMyTransactionsService(req.user!.id);

    res.status(200).json({
      message: "Transactions retrieved successfully",
      data: result,
    });
  } catch (error) {
    next(error);
  }
};
