import express from "express";
import {
    sendMessageController,
    getConversationMessagesController,
    markAsReadController,
    getUnreadCountController,
    getConversationsController
} from "../controllers/message.controller.js";
import { authenticate } from "../middleware/auth.js"
import { validate } from "../middleware/validate.js"
import {
    sendMessageSchema,
    getMessageSchema,
    markAsReadSchema
} from "../validators/message.schema.js";
import { messagingRateLimiter } from "../middleware/rateLimiter.js";

const router = express.Router();

router.use(authenticate);

/**
 * POST /api/message
 * Send a new message
 */
router.post(
    "/",
    messagingRateLimiter,
    validate(sendMessageSchema),
    sendMessageController
);

/**
 * GET /api/messages/conversations
 * Get all conversations for current user
 */
router.get("/conversations", getConversationsController);

/**
 * GET /api/messages/unread-count
 * Get total unread message count
 */
router.get("/unread-count", getUnreadCountController);

/**
 * GET /api/messages/:contextType/:contextId
 * Get messages for a specific conversation
 */
router.get(
    "/:contextType/:contextId",
    validate(getMessageSchema),
    getConversationMessagesController
);

/**
 * PUT /api/messages/:contextType/:contextId/read
 * Mark all messages as read in a conversation
 */
router.put(
    "/:contextType/:contextId/read",
    validate(markAsReadSchema),
    markAsReadController
);

export default router;