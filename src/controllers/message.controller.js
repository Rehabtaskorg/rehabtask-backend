import { createMessage, getConversationMessages, markMessagesAsRead, getUnreadCount, getUserConversations } from "../services/message.service.js";

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

        res.status(200).json({
            success: true,
            data: {
                messages,
                hasMore: messages.length === parseInt(limit || 50),
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