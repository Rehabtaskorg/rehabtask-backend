import express from "express";
import {
    createConnectAccountController, createPaymentIntentController,
    getConnectAccountStatusController, getPaymentHistoryController,
    getPayoutHistoryController, processRefundController,
    createDashboardLinkController,
    getPaymentMethodsController,
    createSetupIntentController,
    removePaymentMethodController,
    setDefaultPaymentMethodController,
} from "../controllers/payment.controller.js";
import { authenticate, authorize } from "../middleware/auth.js";
import { sensitiveOperationRateLimiter } from "../middleware/rateLimiter.js";
import { validate } from "../middleware/validate.js";
import { createPaymentIntentSchema, refundSchema, paymentMethodIdParamSchema } from "../validators/payment.schema.js";

const router = express.Router();

// Customer routes
router.post("/create-intent", authenticate, authorize(["customer"]), sensitiveOperationRateLimiter, validate(createPaymentIntentSchema), createPaymentIntentController);
router.get("/history", authenticate, authorize(["customer"]), getPaymentHistoryController);
router.post("/refund", authenticate, authorize(["customer"]), sensitiveOperationRateLimiter, validate(refundSchema), processRefundController);

// Saved payment methods
router.get("/methods", authenticate, authorize(["customer"]), getPaymentMethodsController);
router.post("/methods/setup", authenticate, authorize(["customer"]), sensitiveOperationRateLimiter, createSetupIntentController);
router.delete("/methods/:paymentMethodId", authenticate, authorize(["customer"]), sensitiveOperationRateLimiter, validate(paymentMethodIdParamSchema, "params"), removePaymentMethodController);
router.post("/methods/:paymentMethodId/default", authenticate, authorize(["customer"]), sensitiveOperationRateLimiter, validate(paymentMethodIdParamSchema, "params"), setDefaultPaymentMethodController);

// Commission rate (authenticated — therapists need this for offer UI)
router.get("/commission-rate", authenticate, async (req, res, next) => {
    try {
        const { getCommissionRate } = await import("../services/commission.service.js");
        const rate = await getCommissionRate();
        res.json({ success: true, data: { rate } });
    } catch (err) { next(err); }
});

// Therapist routes
router.post("/connect/create", authenticate, authorize(["therapist"]), createConnectAccountController);
router.get("/connect/status", authenticate, authorize(["therapist"]), getConnectAccountStatusController);
router.get("/payouts", authenticate, authorize(["therapist"]), getPayoutHistoryController);
router.post("/dashboard/create", authenticate, authorize(["therapist"]), createDashboardLinkController);

// NOTE: Payment release is handled exclusively through the session confirmation flow:
//   POST /sessions/:sessionId/confirm → confirmByCustomerController → releasePayment()
// No standalone release endpoint is exposed — this prevents IDOR attacks.

export default router;