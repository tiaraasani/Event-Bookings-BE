import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
import { authenticate } from "../../middlewares/auth.js";
import { validate } from "../../middlewares/validate.js";
import {
  createVoucherController,
  getMyVouchersController,
  updateVoucherController,
  deleteVoucherController,
  getPublicPromotionsController,
} from "./voucher.controller.js";
import {
  createVoucherSchema,
  updateVoucherSchema,
} from "./voucher.validation.js";

const router = Router();

router.get("/public", getPublicPromotionsController);

const requireOrganizer = (req: Request, res: Response, next: NextFunction) => {
  if (req.user?.role !== "ORGANIZER") {
    return res.status(403).json({
      message: "Only organizers can manage vouchers",
    });
  }

  next();
};

router.use(authenticate, requireOrganizer);

router.get("/", getMyVouchersController);
router.post("/", validate(createVoucherSchema), createVoucherController);
router.patch("/:id", validate(updateVoucherSchema), updateVoucherController);
router.delete("/:id", deleteVoucherController);

export default router;
