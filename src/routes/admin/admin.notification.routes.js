import express from "express";
import { validate } from "../../middleware/validate.js";
import { requirePermission } from "../../middleware/permissions.js";
import { broadcastNotificationSchema } from "../../validators/admin.schema.js";
import {
    adminGetAllNotificationsController,
    adminBroadcastNotificationController,
} from "../../controllers/admin.notification.controller.js";
import { adminOrSubAdmin, adminOnly } from "./adminMiddleware.js";

const router = express.Router();

router.get("/notifications", ...adminOrSubAdmin, requirePermission("notifications"), adminGetAllNotificationsController);
router.post("/notifications/broadcast", ...adminOnly, validate(broadcastNotificationSchema), adminBroadcastNotificationController);

export default router;
