import express from "express";
import {
    getSubscriptionController,
    createCheckoutController,
    createBillingPortalController,
    cancelSubscriptionController,
    upgradeSubscriptionController,
    downgradeSubscriptionController,
} from "../controllers/subscription.controller.js";
import { authenticate, authorize } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { createCheckoutSchema } from "../validators/subscription.schema.js";
import { sensitiveOperationRateLimiter } from "../middleware/rateLimiter.js";

const router = express.Router();

router.get("/current", authenticate, authorize(["customer"]), getSubscriptionController);
router.post("/checkout", authenticate, authorize(["customer"]), sensitiveOperationRateLimiter, validate(createCheckoutSchema), createCheckoutController);
router.post("/billing-portal", authenticate, authorize(["customer"]), sensitiveOperationRateLimiter, createBillingPortalController);
router.post("/cancel", authenticate, authorize(["customer"]), sensitiveOperationRateLimiter, cancelSubscriptionController);
router.post("/upgrade", authenticate, authorize(["customer"]), sensitiveOperationRateLimiter, validate(createCheckoutSchema), upgradeSubscriptionController);
router.post("/downgrade", authenticate, authorize(["customer"]), sensitiveOperationRateLimiter, validate(createCheckoutSchema), downgradeSubscriptionController);

export default router;