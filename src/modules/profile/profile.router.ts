import { Router} from "express";
import { authenticate } from "../../middlewares/auth";
import * as profileController from "./profile.controller"


const router = Router();
router.use(authenticate);

router.get("/", profileController.getProfile);
router.patch("/", profileController.updateProfile);
router.patch("/password", profileController.changePassword);

export default router;
