import { prisma } from "../config/prisma.js";
import { supabaseAdmin } from "../config/supabase.js";
import { logger } from "../config/logger.js";
import { BadRequestError, AuthorizationError } from "../utils/errors.js";
import { findOrCreateDirectConversation, createMessage } from "./message.service.js";
import { getIO } from "../socket/index.js";
import { getUnreadCount } from "./message.service.js";

const BUCKET = "message-attachments";
const MAX_ATTACHMENTS_PER_HOUR = 20;

/**
 * Sanitize filename — remove path traversal and special chars
 */
const sanitizeFileName = (name) =>
    name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 200);

/**
 * Verify the user is a participant of the conversation
 */
const verifyParticipant = async (userId, conversationId) => {
    const conversation = await prisma.directConversation.findFirst({
        where: {
            id: conversationId,
            OR: [{ user1Id: userId }, { user2Id: userId }],
        },
    });
    if (!conversation) {
        throw new AuthorizationError("Access denied to this conversation");
    }
    return conversation;
};

/**
 * Upload attachments with an optional text message.
 *
 * Flow:
 * 1. Verify user is conversation participant
 * 2. Rate-limit check
 * 3. Create the Message row (text content or empty string)
 * 4. Upload each file to Supabase storage
 * 5. Create MessageAttachment rows
 * 6. Broadcast via socket
 *
 * @param {string} senderId - User ID of the sender
 * @param {string} conversationId - DirectConversation ID
 * @param {Array} files - Multer file objects
 * @param {string} content - Optional text content
 * @returns {Object} { message, attachments }
 */
export const uploadMessageAttachments = async (senderId, conversationId, files, content = "", replyToId = null, bookingId = null) => {
    if (!files || files.length === 0) {
        throw new BadRequestError("At least one file is required");
    }

    // 1. Verify participation
    const conversation = await verifyParticipant(senderId, conversationId);
    const recipientId = conversation.user1Id === senderId
        ? conversation.user2Id
        : conversation.user1Id;

    // 2. Rate limit: max attachments per hour
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const recentCount = await prisma.messageAttachment.count({
        where: {
            uploadedById: senderId,
            createdAt: { gte: oneHourAgo },
        },
    });
    if (recentCount + files.length > MAX_ATTACHMENTS_PER_HOUR) {
        throw new BadRequestError(
            `Rate limit: max ${MAX_ATTACHMENTS_PER_HOUR} attachments per hour. You have ${MAX_ATTACHMENTS_PER_HOUR - recentCount} remaining.`
        );
    }

    // 3. Create the message row
    const message = await prisma.message.create({
        data: {
            senderId,
            recipientId,
            conversationId,
            content: content.trim() || "",
            ...(replyToId && { replyToId }),
            ...(bookingId && { bookingId }),
        },
        include: {
            sender: {
                select: {
                    id: true,
                    role: true,
                    therapistProfile: { select: { fullName: true, profilePhotoUrl: true } },
                    customerProfile: { select: { fullName: true, agencyName: true } },
                },
            },
        },
    });

    // 4. Upload files to Supabase and create attachment records
    const attachments = [];
    for (const file of files) {
        const safeName = sanitizeFileName(file.originalname);
        const uniqueId = Math.random().toString(36).slice(2, 10);
        const storagePath = `${conversationId}/${message.id}/${Date.now()}_${uniqueId}_${safeName}`;

        const { error: uploadError } = await supabaseAdmin.storage
            .from(BUCKET)
            .upload(storagePath, file.buffer, {
                contentType: file.mimetype,
                upsert: false,
                cacheControl: "3600",
            });

        if (uploadError) {
            logger.error("[AttachmentService] Supabase upload failed", {
                error: uploadError.message,
                file: safeName,
                conversationId,
            });
            // Continue with other files — don't fail the entire message for one bad upload
            continue;
        }

        const attachment = await prisma.messageAttachment.create({
            data: {
                messageId: message.id,
                conversationId,
                uploadedById: senderId,
                fileName: file.originalname.slice(0, 255),
                fileSize: file.size,
                mimeType: file.mimetype,
                storagePath,
                bucket: BUCKET,
            },
        });

        attachments.push(attachment);
    }

    if (attachments.length === 0) {
        // All uploads failed — clean up the empty message
        await prisma.message.delete({ where: { id: message.id } });
        throw new BadRequestError("All file uploads failed. Please try again.");
    }

    // 5. Broadcast to conversation room
    const payload = {
        ...message,
        attachments,
        _contextType: "direct",
        _contextId: conversationId,
    };

    const io = getIO();
    if (io) {
        io.to(`conversation:${conversationId}`).emit("message:new", payload);
        io.to(`user:${recipientId}`).emit("message:new", payload);
        const unreadCount = await getUnreadCount(recipientId);
        io.to(`user:${recipientId}`).emit("message:unread_update", { count: unreadCount });
    }

    return { message: { ...message, attachments } };
};

/**
 * Get a signed download URL for an attachment.
 * Verifies the requester is a participant of the conversation.
 */
export const getAttachmentSignedUrl = async (userId, attachmentId) => {
    const attachment = await prisma.messageAttachment.findUnique({
        where: { id: attachmentId },
    });

    if (!attachment) {
        throw new BadRequestError("Attachment not found");
    }

    // Verify participant
    await verifyParticipant(userId, attachment.conversationId);

    const { data, error } = await supabaseAdmin.storage
        .from(attachment.bucket)
        .createSignedUrl(attachment.storagePath, 300); // 5 minutes

    if (error) {
        logger.error("[AttachmentService] Signed URL generation failed", { error: error.message });
        throw new BadRequestError("Failed to generate download URL");
    }

    return {
        signedUrl: data.signedUrl,
        expiresIn: 300,
        fileName: attachment.fileName,
        fileSize: attachment.fileSize,
        mimeType: attachment.mimeType,
    };
};

/**
 * Get all attachments for a conversation (paginated).
 * Used by the sidebar and the "View All" modal.
 *
 * When bookingId is provided, only attachments whose parent message is linked
 * to that booking are returned — preventing cross-booking file leakage when
 * the same therapist/customer pair has multiple bookings.
 */
export const getConversationAttachments = async (userId, conversationId, { limit = 20, cursor, bookingId } = {}) => {
    await verifyParticipant(userId, conversationId);

    let cursorDate = undefined;
    if (cursor) {
        const cursorRow = await prisma.messageAttachment.findUnique({
            where: { id: cursor },
            select: { createdAt: true },
        });
        cursorDate = cursorRow?.createdAt;
    }

    const attachments = await prisma.messageAttachment.findMany({
        where: {
            conversationId,
            ...(bookingId && {
                message: { bookingId },
            }),
            ...(cursorDate && {
                createdAt: { lt: cursorDate },
            }),
        },
        orderBy: { createdAt: "desc" },
        take: limit,
        include: {
            uploadedBy: {
                select: {
                    id: true,
                    role: true,
                    therapistProfile: { select: { fullName: true } },
                    customerProfile: { select: { fullName: true } },
                },
            },
        },
    });

    return {
        attachments,
        hasMore: attachments.length >= limit,
    };
};
