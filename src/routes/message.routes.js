import express from "express";
import {
    sendMessageController,
    sendDirectMessageController,
    getConversationMessagesController,
    markAsReadController,
    getUnreadCountController,
    getConversationsController,
    getConversationContextController,
    getMessagesByConversationController,
    markAsReadByConversationController,
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
import { uploadAttachments, handleMulterError } from "../middleware/upload.middleware.js";
import {
    uploadAttachmentsController,
    getAttachmentUrlController,
    getConversationAttachmentsController,
} from "../controllers/attachment.controller.js";

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
 * POST /api/messages/c/:conversationId/attachments
 * Upload attachments with optional text message
 */
router.post(
    "/c/:conversationId/attachments",
    uploadAttachments,
    handleMulterError,
    uploadAttachmentsController
);

/**
 * GET /api/messages/c/:conversationId/attachments
 * List all attachments in a conversation (paginated)
 */
router.get("/c/:conversationId/attachments", getConversationAttachmentsController);

/**
 * GET /api/messages/attachments/:attachmentId/url
 * Get signed download URL for a specific attachment
 */
router.get("/attachments/:attachmentId/url", getAttachmentUrlController);

/**
 * GET /api/messages/c/:conversationId
 * Get messages by conversationId (Phase 3)
 */
router.get("/c/:conversationId", getMessagesByConversationController);

/**
 * PUT /api/messages/c/:conversationId/read
 * Mark messages as read by conversationId (Phase 3)
 */
router.put("/c/:conversationId/read", markAsReadByConversationController);

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