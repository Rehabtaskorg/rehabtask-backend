import express from "express";
import {
    sendDirectMessageController,
    sendMessageByConversationController,
    getUserPublicInfoController,
    getUnreadCountController,
    getConversationsController,
    getMessagesByConversationController,
    markAsReadByConversationController,
} from "../controllers/message.controller.js";
import { authenticate } from "../middleware/auth.js"
import { validate } from "../middleware/validate.js"
import {
    sendDirectMessageSchema,
    sendMessageByConversationSchema,
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
 * GET /api/messages/users/:userId/info
 * Get basic public info for a user — resolves pending direct recipient name
 */
router.get("/users/:userId/info", getUserPublicInfoController);

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
 * POST /api/messages/c/:conversationId
 * Phase 3: Send a message by conversationId — no contextType needed
 */
router.post(
    "/c/:conversationId",
    messagingRateLimiter,
    validate(sendMessageByConversationSchema, "body"),
    sendMessageByConversationController
);

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

export default router;