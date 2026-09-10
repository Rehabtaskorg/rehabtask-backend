import express from "express";
import { validate, validateMultiple } from "../../middleware/validate.js";
import { requirePermission } from "../../middleware/permissions.js";
import {
    adminListPaymentsQuerySchema,
    paymentIdParamSchema,
    adminRefundPaymentSchema,
    adminReleasePaymentSchema,
} from "../../validators/admin.schema.js";
import {
    adminListPaymentsController,
    adminGetPaymentController,
    adminGetPaymentStatsController,
    adminReleasePaymentController,
    adminReleaseRemainderController,
    adminRefundPaymentController,
} from "../../controllers/admin.payment.controller.js";
import { adminOrSubAdmin } from "./adminMiddleware.js";

const router = express.Router();

router.get("/payments/stats", ...adminOrSubAdmin, requirePermission("payments"), adminGetPaymentStatsController);
router.get("/payments", ...adminOrSubAdmin, requirePermission("payments"), validate(adminListPaymentsQuerySchema, "query"), adminListPaymentsController);
router.get("/payments/:paymentId", ...adminOrSubAdmin, requirePermission("payments"), validate(paymentIdParamSchema, "params"), adminGetPaymentController);
router.put("/payments/:paymentId/release", ...adminOrSubAdmin, requirePermission("payments"), validateMultiple({ params: paymentIdParamSchema, body: adminReleasePaymentSchema }), adminReleasePaymentController);
router.put("/payments/:paymentId/release-remainder", ...adminOrSubAdmin, requirePermission("payments"), validateMultiple({ params: paymentIdParamSchema }), adminReleaseRemainderController);
router.put("/payments/:paymentId/refund", ...adminOrSubAdmin, requirePermission("payments"), validateMultiple({ params: paymentIdParamSchema, body: adminRefundPaymentSchema }), adminRefundPaymentController);

export default router;
