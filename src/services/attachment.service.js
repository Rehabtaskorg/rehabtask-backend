import { prisma } from "../config/prisma.js";
import { gcs } from "../config/gcs.js";
import { logger } from "../config/logger.js";
import { BadRequestError, AuthorizationError } from "../utils/errors.js";
import { getUnreadCount } from "./message.service.js";
import { getIO } from "../socket/index.js";
import { TIME_MS, MESSAGE_ATTACHMENTS_BUCKET, USER_ROLES, APPROVAL_STATUS } from "../utils/constants.js";

const MAX_ATTACHMENTS_PER_HOUR = 20;
const SIGNED_URL_TTL_SECONDS = 300;

const sanitizeFileName = (name) =>
    name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 200);

const verifyParticipant = async (userId, conversationId) => {
    const conversation = await prisma.directConversation.findFirst({
        where: {
            id: conversationId,
            OR: [{ user1Id: userId }, { user2Id: userId }],
        },
    });
    if (!conversation) throw new AuthorizationError("Access denied to this conversation");
    return conversation;
};

/**
 * @param {string} senderId
 * @param {string} conversationId
 * @param {import("multer").File[]} files
 * @param {string} [content]
 * @param {string|null} [replyToId]
 * @param {string|null} [bookingId]
 * @returns {Promise<{ message: object }>}
 */
export const uploadMessageAttachments = async (senderId, conversationId, files, content = "", replyToId = null, bookingId = null) => {
    if (!files || files.length === 0) throw new BadRequestError("At least one file is required");

    const [conversation, sender] = await Promise.all([
        verifyParticipant(senderId, conversationId),
        prisma.user.findUnique({
            where: { id: senderId },
            select: { role: true, customerProfile: { select: { onboardingComplete: true, approvalStatus: true } } },
        }),
    ]);

    if (sender?.role === USER_ROLES.CUSTOMER) {
        if (!sender.customerProfile?.onboardingComplete) {
            throw new AuthorizationError(
                "Your account setup is not complete. Finish onboarding before messaging therapists.",
                "ONBOARDING_INCOMPLETE"
            );
        }
        if (sender.customerProfile?.approvalStatus !== APPROVAL_STATUS.APPROVED) {
            throw new AuthorizationError(
                "Your account is pending approval. You'll be able to message therapists once an admin approves your account.",
                "NOT_APPROVED"
            );
        }
    }

    const recipientId = conversation.user1Id === senderId
        ? conversation.user2Id
        : conversation.user1Id;

    const oneHourAgo = new Date(Date.now() - TIME_MS.ONE_HOUR);
    const recentCount = await prisma.messageAttachment.count({
        where: { uploadedById: senderId, createdAt: { gte: oneHourAgo } },
    });
    if (recentCount + files.length > MAX_ATTACHMENTS_PER_HOUR) {
        throw new BadRequestError(
            `Rate limit: max ${MAX_ATTACHMENTS_PER_HOUR} attachments per hour. You have ${MAX_ATTACHMENTS_PER_HOUR - recentCount} remaining.`
        );
    }

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

    const attachments = [];
    for (const file of files) {
        const safeName = sanitizeFileName(file.originalname);
        const uniqueId = Math.random().toString(36).slice(2, 10);
        const storagePath = `${conversationId}/${message.id}/${Date.now()}_${uniqueId}_${safeName}`;

        try {
            await gcs.bucket(MESSAGE_ATTACHMENTS_BUCKET).file(storagePath).save(file.buffer, {
                contentType: file.mimetype,
                resumable: false,
                metadata: { cacheControl: "private, max-age=3600" },
            });
        } catch (err) {
            logger.error("GCS attachment upload failed", {
                error: err.message,
                file: safeName,
                conversationId,
            });
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
                bucket: MESSAGE_ATTACHMENTS_BUCKET,
            },
        });

        attachments.push(attachment);
    }

    if (attachments.length === 0) {
        await prisma.message.delete({ where: { id: message.id } });
        throw new BadRequestError("All file uploads failed. Please try again.");
    }

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
 * @param {string} userId
 * @param {string} attachmentId
 * @returns {Promise<{ signedUrl: string, expiresIn: number, fileName: string, fileSize: number, mimeType: string }>}
 */
export const getAttachmentSignedUrl = async (userId, attachmentId) => {
    const attachment = await prisma.messageAttachment.findUnique({
        where: { id: attachmentId },
    });
    if (!attachment) throw new BadRequestError("Attachment not found");

    await verifyParticipant(userId, attachment.conversationId);

    const [url] = await gcs
        .bucket(attachment.bucket)
        .file(attachment.storagePath)
        .getSignedUrl({
            version: "v4",
            action: "read",
            expires: Date.now() + SIGNED_URL_TTL_SECONDS * 1000,
        });

    return {
        signedUrl: url,
        expiresIn: SIGNED_URL_TTL_SECONDS,
        fileName: attachment.fileName,
        fileSize: attachment.fileSize,
        mimeType: attachment.mimeType,
    };
};

/**
 * @param {string} userId
 * @param {string} conversationId
 * @param {{ limit?: number, cursor?: string, bookingId?: string }} [options]
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
            ...(bookingId && { message: { bookingId } }),
            ...(cursorDate && { createdAt: { lt: cursorDate } }),
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
