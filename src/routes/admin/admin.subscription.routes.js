import express from "express";
import { validate } from "../../middleware/validate.js";
import { requirePermission } from "../../middleware/permissions.js";
import { adminListSubscriptionsQuerySchema, subscriptionIdParamSchema } from "../../validators/admin.schema.js";
import {
    adminListSubscriptionsController,
    adminGetSubscriptionController,
    adminCancelSubscriptionController,
    adminGetSubscriptionStatsController,
} from "../../controllers/admin.subscription.controller.js";
import { adminOrSubAdmin } from "./adminMiddleware.js";

const router = express.Router();

router.get("/subscriptions/stats", ...adminOrSubAdmin, requirePermission("subscriptions"), adminGetSubscriptionStatsController);
router.get("/subscriptions", ...adminOrSubAdmin, requirePermission("subscriptions"), validate(adminListSubscriptionsQuerySchema, "query"), adminListSubscriptionsController);
router.get("/subscriptions/:subscriptionId", ...adminOrSubAdmin, requirePermission("subscriptions"), validate(subscriptionIdParamSchema, "params"), adminGetSubscriptionController);
router.put("/subscriptions/:subscriptionId/cancel", ...adminOrSubAdmin, requirePermission("subscriptions"), validate(subscriptionIdParamSchema, "params"), adminCancelSubscriptionController);

export default router;
