import { Router } from "express";
import { authenticate, authorize } from "../../middlewares/auth";
import * as organizerController from "./organizer.controller";

const router = Router();
router.use(authenticate, authorize("ORGANIZER"));

router.get("/transactions", organizerController.getTransactions);
router.patch("/transactions/:id/accept", organizerController.acceptTransaction);
router.patch("/transactions/:id/reject", organizerController.rejectTransaction);

export default router;
