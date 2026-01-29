import express from "express";
import {
    getCurrentUserController, loginController, logoutController,
    registerCustomerController, registerTherapistController,
} from "../controllers/auth.controller.js";
import { authenticate } from "../middleware/auth.js";

const router = express.Router();

router.post("/register/customer", registerCustomerController);
router.post("/register/therapist", registerTherapistController);
router.post("/login", loginController);
router.post("/logout", authenticate, logoutController);
router.get("/me", authenticate, getCurrentUserController);

export default router;