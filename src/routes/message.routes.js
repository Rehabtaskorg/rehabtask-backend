import express from "express";
import {
    sendMessageController,
    sendDirectMessageController,
    getConversationMessagesController,
    markAsReadController,
    getUnreadCountController,
    getConversationsController,
    getConversationContextController
} from "../controllers/message.controller.js";
import { authenticate } from "../middleware/auth.js"
import { validate, validateMultiple } from "../middleware/validate.js"
import {
    sendMessageSchema,
    sendDirectMessageSchema,
    markAsReadSchema,
    getMessagesSchema,
    getContextSchema
} from "../validators/message.schema.js";
import { messagingRateLimiter, conversationsRateLimiter } from "../middleware/rateLimiter.js";

const router = express.Router();

router.use(authenticate);

/**
 * POST /api/message
 * Send a new message
 */
router.post(
    "/",
    messagingRateLimiter,
    validate(sendMessageSchema, "body"),
    sendMessageController
);
/**
 * POST /api/messages/direct
 * Send a direct message (creates conversation if needed)
 */
router.post(
    "/direct",
    messagingRateLimiter,
    validate(sendDirectMessageSchema, "body"),
    sendDirectMessageController
);

/**
 * GET /api/messages/conversations
 * Get all conversations for current user
 */
router.get("/conversations", conversationsRateLimiter, getConversationsController);

/**
 * GET /api/messages/unread-count
 * Get total unread message count
 */
router.get("/unread-count", getUnreadCountController);

/**
 * GET /api/messages/:contextType/:contextId/context
 * Get the other party's info for a conversation (used when no messages exist yet)
 * IMPORTANT: must be registered BEFORE /:contextType/:contextId to avoid being swallowed
 */
router.get(
    "/:contextType/:contextId/context",
    validateMultiple(getContextSchema),
    getConversationContextController
);

/**
 * GET /api/messages/:contextType/:contextId
 * Get messages for a specific conversation
 */
router.get(
    "/:contextType/:contextId",
    validateMultiple(getMessagesSchema),
    getConversationMessagesController
);

/**
 * PUT /api/messages/:contextType/:contextId/read
 * Mark all messages as read in a conversation
 */
router.put(
    '/:contextType/:contextId/read',
    validateMultiple(markAsReadSchema),
    markAsReadController
);

export default router;