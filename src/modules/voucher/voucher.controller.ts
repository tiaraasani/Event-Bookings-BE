import type { Request, Response, NextFunction } from "express";
import {
  createVoucherService,
  getMyVouchersService,
  updateVoucherService,
  deleteVoucherService,
  getPublicPromotionsService,
} from "./voucher.service.js";

export const createVoucherController = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const voucher = await createVoucherService(req.user!.id, req.body);

    res.status(201).json({
      message: "Voucher created successfully",
      data: voucher,
    });
  } catch (error) {
    next(error);
  }
};

export const getMyVouchersController = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const vouchers = await getMyVouchersService(req.user!.id);

    res.status(200).json({
      message: "Vouchers retrieved successfully",
      data: vouchers,
    });
  } catch (error) {
    next(error);
  }
};

export const updateVoucherController = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const voucherId = Number(req.params.id);

    if (!Number.isInteger(voucherId) || voucherId <= 0) {
      res.status(400).json({ message: "Invalid voucher ID" });
      return;
    }

    const voucher = await updateVoucherService(
      req.user!.id,
      voucherId,
      req.body,
    );

    res.status(200).json({
      message: "Voucher updated successfully",
      data: voucher,
    });
  } catch (error) {
    next(error);
  }
};

export const deleteVoucherController = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const voucherId = Number(req.params.id);

    if (!Number.isInteger(voucherId) || voucherId <= 0) {
      res.status(400).json({ message: "Invalid voucher ID" });
      return;
    }

    const result = await deleteVoucherService(req.user!.id, voucherId);

    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
};
export const getPublicPromotionsController = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const promotions = await getPublicPromotionsService();

    res.status(200).json({
      message: "Promotions retrieved successfully",
      data: promotions,
    });
  } catch (error) {
    next(error);
  }
};
