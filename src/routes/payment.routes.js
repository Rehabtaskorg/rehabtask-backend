import express from "express";
import {
    createConnectAccountController, createPaymentIntentController,
    getConnectAccountStatusController, getPaymentHistoryController,
    getPayoutHistoryController, processRefundController,
    releasePaymentController, createDashboardLinkController
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

// Admin/System Route
router.post("/release", authenticate, releasePaymentController);

export default router;