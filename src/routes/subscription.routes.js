import { USER_ROLES } from "../utils/constants.js";
import express from "express";
import {
    getSubscriptionController,
    createCheckoutController,
    createBillingPortalController,
    cancelSubscriptionController,
    resumeSubscriptionController,
    previewUpgradeController,
    upgradeSubscriptionController,
    downgradeSubscriptionController,
    cancelScheduledDowngradeController,
} from "../controllers/subscription.controller.js";
import { authenticate, authorize, requireCustomerApproval } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { createCheckoutSchema } from "../validators/subscription.schema.js";
import { sensitiveOperationRateLimiter } from "../middleware/rateLimiter.js";

const router = express.Router();

router.get("/current", authenticate, authorize([USER_ROLES.CUSTOMER]), requireCustomerApproval, getSubscriptionController);
router.post("/checkout", authenticate, authorize([USER_ROLES.CUSTOMER]), requireCustomerApproval, sensitiveOperationRateLimiter, validate(createCheckoutSchema), createCheckoutController);
router.post("/billing-portal", authenticate, authorize([USER_ROLES.CUSTOMER]), sensitiveOperationRateLimiter, createBillingPortalController);
router.post("/cancel", authenticate, authorize([USER_ROLES.CUSTOMER]), sensitiveOperationRateLimiter, cancelSubscriptionController);
router.post("/resume", authenticate, authorize([USER_ROLES.CUSTOMER]), sensitiveOperationRateLimiter, resumeSubscriptionController);
router.post("/preview-upgrade", authenticate, authorize([USER_ROLES.CUSTOMER]), validate(createCheckoutSchema), previewUpgradeController);
router.post("/upgrade", authenticate, authorize([USER_ROLES.CUSTOMER]), requireCustomerApproval, sensitiveOperationRateLimiter, validate(createCheckoutSchema), upgradeSubscriptionController);
router.post("/downgrade", authenticate, authorize([USER_ROLES.CUSTOMER]), requireCustomerApproval, sensitiveOperationRateLimiter, validate(createCheckoutSchema), downgradeSubscriptionController);
router.delete("/downgrade", authenticate, authorize([USER_ROLES.CUSTOMER]), requireCustomerApproval, sensitiveOperationRateLimiter, cancelScheduledDowngradeController);

export default router;