import {
    createDirectMessage,
    sendMessageByConversation,
    getConversationMessagesByConvId,
    markMessagesAsReadByConvId,
    getUnreadCount, getUserConversations,
    getUserPublicInfo,
} from "../services/message.service.js";

/**
 * Send a direct message (get-or-create conversation + send)
 */
export const sendDirectMessageController = async (req, res, next) => {
    try {
        const { recipientId, content } = req.body;
        const senderId = req.user.id;

        const message = await createDirectMessage({
            senderId,
            recipientId,
            content,
        });

        res.status(201).json({
            success: true,
            message: "Message sent successfully",
            data: { message },
        });
    } catch (error) {
        next(error);
    }
}

/**
 * Get unread message count
 */
export const getUnreadCountController = async (req, res, next) => {
    try {
        const count = await getUnreadCount(req.user.id);

        res.status(200).json({
            success: true,
            data: { count },
        });
    } catch (error) {
        next(error);
    }
}

/**
 * Get all conversations for current user
 */
export const getConversationsController = async (req, res, next) => {
    try {
        const conversations = await getUserConversations(req.user.id);

        res.status(200).json({
            success: true,
            data: { conversations },
        });
    } catch (error) {
        next(error);
    }
}

// ─── Phase 3: conversationId-based endpoints ───────────────────────

/**
 * Get basic public info for a user — used to resolve a pending direct recipient's
 * name before any conversation exists between them.
 */
export const getUserPublicInfoController = async (req, res, next) => {
    try {
        const { userId } = req.params;
        const info = await getUserPublicInfo(req.user.id, userId);
        res.status(200).json({ success: true, data: info });
    } catch (error) {
        next(error);
    }
};

/**
 * Send a message by conversationId (Phase 3 — no contextType needed)
 */
export const sendMessageByConversationController = async (req, res, next) => {
    try {
        const { conversationId } = req.params;
        const { content, replyToId } = req.body;
        const senderId = req.user.id;

        const message = await sendMessageByConversation(senderId, conversationId, content, replyToId);

        res.status(201).json({
            success: true,
            message: "Message sent successfully",
            data: { message },
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Get messages by conversationId
 */
export const getMessagesByConversationController = async (req, res, next) => {
    try {
        const { conversationId } = req.params;
        const { limit, cursor, order } = req.query;

        const messages = await getConversationMessagesByConvId(
            req.user.id,
            conversationId,
            {
                limit: limit ? parseInt(limit) : undefined,
                cursor,
                order,
            }
        );

        const parsedLimit = limit ? parseInt(limit) : 50;

        res.status(200).json({
            success: true,
            data: {
                messages,
                hasMore: messages.length >= parsedLimit,
            },
        });
    } catch (error) {
        next(error);
    }
}

/**
 * Mark messages as read by conversationId
 */
export const markAsReadByConversationController = async (req, res, next) => {
    try {
        const { conversationId } = req.params;
        const count = await markMessagesAsReadByConvId(req.user.id, conversationId);

        res.status(200).json({
            success: true,
            message: `${count} message(s) marked as read`,
            data: { count },
        });
    } catch (error) {
        next(error);
    }
}