import {
    createMessage, createDirectMessage,
    getConversationMessages, getConversationMessagesByConvId,
    markMessagesAsRead, markMessagesAsReadByConvId,
    getUnreadCount, getUserConversations, getConversationContext
} from "../services/message.service.js";

/**
 * Send a new message
 */
export const sendMessageController = async (req, res, next) => {
    try {
        const { content, contextType, contextId } = req.body;
        const senderId = req.user.id;

        const message = await createMessage({
            senderId,
            content,
            contextType,
            contextId
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
 * Get messages for a specific conversation
 */
export const getConversationMessagesController = async (req, res, next) => {
    try {
        const { contextType, contextId } = req.params;
        const { limit, cursor, order } = req.query;

        const messages = await getConversationMessages(
            req.user.id,
            contextType,
            contextId,
            {
                limit: limit ? parseInt(limit) : undefined,
                cursor,
                order,
            }
        );

        // For stitched threads (direct/booking), _totalRealMessages tracks actual message count
        // excluding system dividers. For standard queries, use array length.
        const realCount = messages._totalRealMessages ?? messages.length;
        const parsedLimit = limit ? parseInt(limit) : 50;

        res.status(200).json({
            success: true,
            data: {
                messages,
                hasMore: realCount >= parsedLimit,
            },
        });
    } catch (error) {
        next(error);
    }
}

/**
 * Mark messages as read in a conversation
 */
export const markAsReadController = async (req, res, next) => {
    try {
        const { contextType, contextId } = req.params;
        const count = await markMessagesAsRead(req.user.id, contextType, contextId);

        res.status(200).json({
            success: true,
            message: `${count} message(s) marked as read`,
            data: { count },
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

/**
 * Get the other party's info for a conversation (used when no messages exist yet)
 */
export const getConversationContextController = async (req, res, next) => {
    try {
        const { contextType, contextId } = req.params;
        const context = await getConversationContext(req.user.id, contextType, contextId);

        res.status(200).json({
            success: true,
            data: context
        });
    } catch (error) {
        next(error);
    }
}

// ─── Phase 3: conversationId-based endpoints ───────────────────────

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