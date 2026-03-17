import express from "express";
import {
    getNotificationsController,
    markAllAsReadController,
    markAsReadController
} from "../controllers/notification.controller.js";
import { authenticate } from "../middleware/auth.js"

const router = express.Router();

// GET /api/notifications — user's own notifications (?page, ?limit, ?unreadOnly)
router.get("/", authenticate, getNotificationsController);

// PUT /api/notifications/read-all — mark all as read
router.put("/read-all", authenticate, markAllAsReadController)

// PUT /api/notifications/:notificationId/read — mark one as read
router.put("/:notificationId/read", authenticate, markAsReadController);

export default router;