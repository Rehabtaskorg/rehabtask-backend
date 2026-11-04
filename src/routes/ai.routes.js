import express from "express";
import { chatController, leadController } from "../controllers/ai.controller.js";
import { optionalAuthenticate } from "../middleware/auth.js";
import { aiChatBurstLimiter, aiChatHourlyLimiter } from "../middleware/rateLimiter.js";
import { recaptchaMiddleware } from "../middleware/recaptcha.js";
import { validate } from "../middleware/validate.js";
import { chatSchema, leadSchema } from "../validators/ai.schema.js";

const router = express.Router();

router.post(
    "/chat",
    optionalAuthenticate,
    aiChatBurstLimiter,
    aiChatHourlyLimiter,
    validate(chatSchema),
    chatController
);

router.post(
    "/lead",
    aiChatBurstLimiter,
    aiChatHourlyLimiter,
    recaptchaMiddleware,
    validate(leadSchema),
    leadController
);

export default router;
