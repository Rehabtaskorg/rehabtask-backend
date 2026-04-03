import {
    uploadMessageAttachments,
    getAttachmentSignedUrl,
    getConversationAttachments,
} from "../services/attachment.service.js";

/**
 * Upload attachments to a conversation
 * POST /api/messages/c/:conversationId/attachments
 */
export const uploadAttachmentsController = async (req, res, next) => {
    try {
        const { conversationId } = req.params;
        const content = req.body?.content || "";
        const replyToId = req.body?.replyToId || null;
        const files = req.files;

        const result = await uploadMessageAttachments(
            req.user.id,
            conversationId,
            files,
            content,
            replyToId
        );

        res.status(201).json({
            success: true,
            message: "Attachments uploaded successfully",
            data: result,
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Get signed download URL for an attachment
 * GET /api/messages/attachments/:attachmentId/url
 */
export const getAttachmentUrlController = async (req, res, next) => {
    try {
        const { attachmentId } = req.params;
        const result = await getAttachmentSignedUrl(req.user.id, attachmentId);

        res.status(200).json({
            success: true,
            data: result,
        });
    } catch (error) {
        next(error);
    }
};

/**
 * List attachments for a conversation
 * GET /api/messages/c/:conversationId/attachments
 */
export const getConversationAttachmentsController = async (req, res, next) => {
    try {
        const { conversationId } = req.params;
        const { limit, cursor } = req.query;

        const result = await getConversationAttachments(
            req.user.id,
            conversationId,
            {
                limit: limit ? parseInt(limit) : 20,
                cursor: cursor || undefined,
            }
        );

        res.status(200).json({
            success: true,
            data: result,
        });
    } catch (error) {
        next(error);
    }
};
