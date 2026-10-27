import express from "express";
import { chatController } from "../controllers/ai.controller.js";
import { optionalAuthenticate } from "../middleware/auth.js";
import { aiChatBurstLimiter, aiChatHourlyLimiter } from "../middleware/rateLimiter.js";
import { validate } from "../middleware/validate.js";
import { chatSchema } from "../validators/ai.schema.js";

const router = express.Router();

router.post(
    "/chat",
    optionalAuthenticate,
    aiChatBurstLimiter,
    aiChatHourlyLimiter,
    validate(chatSchema),
    chatController
);

export default router;
