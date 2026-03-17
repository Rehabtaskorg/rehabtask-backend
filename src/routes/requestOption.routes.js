import express from "express";
import { getRequestOptionsController } from "../controllers/requestOption.controller.js";
import { authenticate } from "../middleware/auth.js";

const router = express.Router();

router.get("/", authenticate, getRequestOptionsController);

export default router;