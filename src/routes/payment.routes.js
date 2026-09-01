import { USER_ROLES } from "../utils/constants.js";
import express from "express";
import {
    createPaymentIntentController,
    getPaymentHistoryController,
    getPayoutHistoryController,
    createConnectAccountController,
    createAccountSessionController,
    getConnectAccountStatusController,
    getPaymentMethodsController,
    createSetupIntentController,
    removePaymentMethodController,
    setDefaultPaymentMethodController,
    createCustomerConnectAccountController,
    createCustomerAccountSessionController,
    getCustomerConnectStatusController,
    getCustomerRefundSummaryController,
    getCustomerRefundHistoryController,
} from "../controllers/payment.controller.js";
import { authenticate, authorize, requireCustomerApproval } from "../middleware/auth.js";
import { sensitiveOperationRateLimiter } from "../middleware/rateLimiter.js";
import { validate } from "../middleware/validate.js";
import { createPaymentIntentSchema, paymentMethodIdParamSchema, createConnectAccountSchema, createCustomerConnectAccountSchema } from "../validators/payment.schema.js";

const router = express.Router();

// Customer routes
router.post("/create-intent", authenticate, authorize([USER_ROLES.CUSTOMER]), requireCustomerApproval, sensitiveOperationRateLimiter, validate(createPaymentIntentSchema), createPaymentIntentController);
router.get("/history", authenticate, authorize([USER_ROLES.CUSTOMER]), getPaymentHistoryController);
// Saved payment methods
router.get("/methods", authenticate, authorize([USER_ROLES.CUSTOMER]), getPaymentMethodsController);
router.post("/methods/setup", authenticate, authorize([USER_ROLES.CUSTOMER]), requireCustomerApproval, sensitiveOperationRateLimiter, createSetupIntentController);
router.delete("/methods/:paymentMethodId", authenticate, authorize([USER_ROLES.CUSTOMER]), requireCustomerApproval, sensitiveOperationRateLimiter, validate(paymentMethodIdParamSchema, "params"), removePaymentMethodController);
router.post("/methods/:paymentMethodId/default", authenticate, authorize([USER_ROLES.CUSTOMER]), requireCustomerApproval, sensitiveOperationRateLimiter, validate(paymentMethodIdParamSchema, "params"), setDefaultPaymentMethodController);

// Customer Connect account (for receiving refunds)
router.post("/customer-connect/create", authenticate, authorize([USER_ROLES.CUSTOMER]), requireCustomerApproval, sensitiveOperationRateLimiter, validate(createCustomerConnectAccountSchema), createCustomerConnectAccountController);
router.get("/customer-connect/status", authenticate, authorize([USER_ROLES.CUSTOMER]), getCustomerConnectStatusController);
router.post("/customer-connect/account-session", authenticate, authorize([USER_ROLES.CUSTOMER]), sensitiveOperationRateLimiter, createCustomerAccountSessionController);

// Customer refund endpoints
router.get("/refunds/summary", authenticate, authorize([USER_ROLES.CUSTOMER]), getCustomerRefundSummaryController);
router.get("/refunds/history", authenticate, authorize([USER_ROLES.CUSTOMER]), getCustomerRefundHistoryController);

// Commission rate (authenticated — therapists need this for offer UI)
router.get("/commission-rate", authenticate, async (req, res, next) => {
    try {
        const { getCommissionRate } = await import("../services/commission.service.js");
        const rate = await getCommissionRate();
        res.json({ success: true, data: { rate } });
    } catch (err) { next(err); }
});

// Therapist routes
router.post("/connect/create", authenticate, authorize([USER_ROLES.THERAPIST]), sensitiveOperationRateLimiter, validate(createConnectAccountSchema), createConnectAccountController);
router.get("/connect/status", authenticate, authorize([USER_ROLES.THERAPIST]), getConnectAccountStatusController);

// Account Session — creates a short-lived client_secret for the frontend
// StripeConnectProvider (embedded onboarding + earnings dashboard components).
// Rate-limited: Stripe sessions expire after ~60 min and fetchClientSecret is
// called automatically, so normal usage is well within the 20/hr limit.
router.post("/account-session", authenticate, authorize([USER_ROLES.THERAPIST]), sensitiveOperationRateLimiter, createAccountSessionController);

router.get("/payouts", authenticate, authorize([USER_ROLES.THERAPIST]), getPayoutHistoryController);
// /dashboard/create removed — external Stripe Express Dashboard replaced by embedded ConnectBalances.

// NOTE: Payment release is handled exclusively through the session confirmation flow:
//   POST /sessions/:sessionId/confirm → confirmByCustomerController → releasePayment()
// No standalone release endpoint is exposed — this prevents IDOR attacks.

export default router;