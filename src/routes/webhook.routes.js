import express from "express";
import { handleStripeWebhook } from "../controllers/webhook.controller.js";

const router = express.Router();

// Stripe webhook endpoint - NO AUTHENTICATION, RAW BODY REQUIRED
router.post(
    "/stripe",
    express.raw({ type: "application/json" }),
    handleStripeWebhook
);

export default router;