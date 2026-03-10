import express from "express";
import {
    createConnectAccountController, createPaymentIntentController,
    getConnectAccountStatusController, getPaymentHistoryController,
    getPayoutHistoryController, processRefundController,
    createDashboardLinkController
} from "../controllers/payment.controller.js";
import { authenticate, authorize } from "../middleware/auth.js";

const router = express.Router();

// Customer routes
router.post("/create-intent", authenticate, authorize(["customer"]), createPaymentIntentController);
router.get("/history", authenticate, authorize(["customer"]), getPaymentHistoryController);
router.post("/refund", authenticate, authorize(["customer"]), processRefundController);

// Therapist routes
router.post("/connect/create", authenticate, authorize(["therapist"]), createConnectAccountController);
router.get("/connect/status", authenticate, authorize(["therapist"]), getConnectAccountStatusController);
router.get("/payouts", authenticate, authorize(["therapist"]), getPayoutHistoryController);
router.post("/dashboard/create", authenticate, authorize(["therapist"]), createDashboardLinkController);

// NOTE: Payment release is handled exclusively through the session confirmation flow:
//   POST /sessions/:sessionId/confirm → confirmByCustomerController → releasePayment()
// No standalone release endpoint is exposed — this prevents IDOR attacks.

export default router;