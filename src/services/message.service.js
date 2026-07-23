import { USER_ROLES, APPROVAL_STATUS } from "../utils/constants.js";
import { prisma } from "../config/prisma.js";
import {
    queryLatestMessagesPerConversation,
    queryContextMessagesPerConversation,
    queryPatientMessagesPerConversation,
} from "./message.queries.js";
import { sendNewMessageNotification } from "./email.service.js";
import { logger } from "../config/logger.js";
import { BadRequestError, AuthorizationError } from "../utils/errors.js"
import { getIO } from "../socket/index.js";
import { isUserOnline } from "../socket/presence.js";

/**
 * Emit an event to a Socket.io room.
 * Safe to call even if Socket.io is not initialized (e.g., during tests).
 */
const emitToRoom = (room, event, payload) => {
    const io = getIO();
    if (!io) return;
    io.to(room).emit(event, payload);
};

export const findOrCreateDirectConversation = async (userIdA, userIdB) => {
    const [user1Id, user2Id] = userIdA < userIdB
        ? [userIdA, userIdB]
        : [userIdB, userIdA];

    const existing = await prisma.directConversation.findUnique({
        where: { user1Id_user2Id: { user1Id, user2Id } },
    });
    if (existing) return existing;

    try {
        return await prisma.directConversation.create({
            data: { user1Id, user2Id },
        });
    } catch (err) {
        // P2002 = unique constraint violation — another request created it first
        if (err.code === "P2002") {
            const found = await prisma.directConversation.findUnique({
                where: { user1Id_user2Id: { user1Id, user2Id } },
            });
            if (found) return found;
        }
        throw err;
    }
};

/**
 * Phase 3: Send a message directly by conversationId.
 * No contextType/contextId needed — the DirectConversation is the single source of truth.
 * Validates the caller is a participant, creates the message, and emits via socket.
 *
 * @param {string} senderId - Authenticated user ID
 * @param {string} conversationId - DirectConversation UUID
 * @param {string} content - Message text (min 1 char)
 * @param {string|undefined} replyToId - Optional reply target message UUID
 * @returns {Promise<object>} Created message with sender relation
 */
export const sendMessageByConversation = async (senderId, conversationId, content, replyToId) => {
    if (!content?.trim()) {
        throw new BadRequestError("Message content cannot be empty", "EMPTY_MESSAGE");
    }

    const [conversation, sender] = await Promise.all([
        prisma.directConversation.findUnique({
            where: { id: conversationId },
            select: { id: true, user1Id: true, user2Id: true },
        }),
        prisma.user.findUnique({
            where: { id: senderId },
            select: { role: true, customerProfile: { select: { onboardingComplete: true } } },
        }),
    ]);

    if (!conversation) {
        throw new BadRequestError("Conversation not found", "CONVERSATION_NOT_FOUND");
    }

    const isParticipant = conversation.user1Id === senderId || conversation.user2Id === senderId;
    if (!isParticipant) {
        throw new AuthorizationError("You are not a participant in this conversation");
    }

    if (sender?.role === USER_ROLES.CUSTOMER && !sender.customerProfile?.onboardingComplete) {
        throw new AuthorizationError("Your account setup is not complete. Finish onboarding before messaging therapists.");
    }

    const recipientId = conversation.user1Id === senderId ? conversation.user2Id : conversation.user1Id;

    // Validate reply target belongs to this conversation
    if (replyToId) {
        const replyTarget = await prisma.message.findUnique({ where: { id: replyToId } });
        if (!replyTarget) {
            throw new BadRequestError("Reply target message not found", "REPLY_TARGET_NOT_FOUND");
        }
        if (replyTarget.conversationId !== conversationId) {
            throw new BadRequestError("Cannot reply to a message from a different conversation", "REPLY_TARGET_CONTEXT_MISMATCH");
        }
    }

    // Anti-spam: only notify on the first unread in this conversation
    const existingUnreadCount = await prisma.message.count({
        where: { conversationId, recipientId, readAt: null },
    });
    const shouldEmailNotify = existingUnreadCount === 0;

    const message = await prisma.message.create({
        data: {
            senderId,
            recipientId,
            conversationId,
            content: content.trim(),
            ...(replyToId && { replyToId }),
        },
        include: {
            sender: {
                select: {
                    id: true, email: true, role: true,
                    therapistProfile: { select: { fullName: true, profilePhotoUrl: true } },
                    customerProfile: { select: { fullName: true, agencyName: true } },
                },
            },
        },
    });

    // Socket emission — Phase 3 only, no legacy room
    const isRecipientOnline = isUserOnline(recipientId);
    const payload = {
        ...message,
        _conversationId: conversationId,
    };

    emitToRoom(`conversation:${conversationId}`, "message:new", payload);
    emitToRoom(`user:${recipientId}`, "message:new", payload);

    const unreadCount = await getUnreadCount(recipientId);
    emitToRoom(`user:${recipientId}`, "message:unread_update", { count: unreadCount });

    // Email notification — fire and forget, non-blocking
    if (!isRecipientOnline && shouldEmailNotify) {
        sendNewMessageNotification({ message, recipientId }).catch((err) => {
            logger.error("[MessageService] Email notification failed", { error: err.message });
        });
    }

    return message;
};

/**
 * Create a system message inside a DirectConversation.
 * System messages have a systemType (e.g. "offer_sent", "offer_accepted", "booking_created")
 * and are authored by the actor who triggered the event.
 * Returns the created message (no socket/email side-effects — those are handled by the caller's flow).
 */
export const createSystemMessage = async ({ conversationId, actorId, recipientId, content, systemType, offerId, bookingId, patientId }) => {
    return prisma.message.create({
        data: {
            senderId: actorId,
            recipientId,
            conversationId,
            content,
            systemType,
            ...(offerId && { offerId }),
            ...(bookingId && { bookingId }),
            ...(patientId && { patientId }),
            readAt: new Date(), // system messages are pre-read — they're informational, not unread notifications
        },
    });
};

/**
 * Get conversation messages by conversationId (Phase 3).
 */
export const getConversationMessagesByConvId = async (userId, conversationId, options = {}) => {
    const { limit = 50, cursor } = options;

    // Verify access: user must be a participant
    const conversation = await prisma.directConversation.findFirst({
        where: {
            id: conversationId,
            OR: [{ user1Id: userId }, { user2Id: userId }],
        },
    });
    if (!conversation) {
        throw new AuthorizationError("Access denied to this conversation");
    }

    const senderSelect = {
        select: {
            id: true,
            role: true,
            therapistProfile: { select: { fullName: true, profilePhotoUrl: true } },
            customerProfile: { select: { fullName: true, agencyName: true } },
        },
    };

    // Always fetch in descending order (newest first) and reverse for the frontend.
    // This ensures we get the most recent messages, not the oldest.
    const cursorDate = cursor
        ? (await prisma.message.findUnique({ where: { id: cursor }, select: { createdAt: true } }))?.createdAt
        : null;

    const messages = await prisma.message.findMany({
        where: {
            conversationId,
            ...(cursorDate && { createdAt: { lt: cursorDate } }),
        },
        orderBy: { createdAt: "desc" },
        take: limit,
        include: {
            sender: senderSelect,
            patient: { select: { id: true, fullName: true } },
            attachments: {
                select: {
                    id: true,
                    fileName: true,
                    fileSize: true,
                    mimeType: true,
                    createdAt: true,
                },
                orderBy: { createdAt: "asc" },
            },
            replyTo: {
                select: {
                    id: true,
                    content: true,
                    senderId: true,
                    sender: senderSelect,
                    attachments: {
                        select: { id: true, fileName: true, mimeType: true },
                        take: 1,
                    },
                },
            },
        },
    });

    // Normalize: add `type` field for frontend — system messages get type "system"
    const normalized = messages.map(m => ({
        ...m,
        type: m.systemType ? "system" : "message",
    }));

    // Return in chronological order (oldest first) for display
    return normalized.reverse();
};

/**
 * Mark all messages as read in a conversation by conversationId (Phase 3).
 */
export const markMessagesAsReadByConvId = async (userId, conversationId) => {
    // Verify access
    const conversation = await prisma.directConversation.findFirst({
        where: {
            id: conversationId,
            OR: [{ user1Id: userId }, { user2Id: userId }],
        },
    });
    if (!conversation) {
        throw new AuthorizationError("Access denied to this conversation");
    }

    const result = await prisma.message.updateMany({
        where: {
            conversationId,
            recipientId: userId,
            readAt: null,
        },
        data: { readAt: new Date() },
    });

    // Publish read receipt to the other user
    if (result.count > 0) {
        const otherUserId = conversation.user1Id === userId
            ? conversation.user2Id
            : conversation.user1Id;
        emitToRoom(`user:${otherUserId}`, "messages:marked_read", {
            conversationId,
            readBy: userId,
            count: result.count,
        });
    }

    return result.count;
};

/**
 * Get total unread message count for a user.
 */
export const getUnreadCount = async (userId) => {
    return await prisma.message.count({
        where: {
            recipientId: userId,
            readAt: null,
        }
    });
}

/**
 * Get basic public info for a user by userId.
 * Used by the messaging UI to resolve a pending direct recipient's name
 * before any conversation exists between them.
 *
 * @param {string} requesterId - The authenticated user making the request
 * @param {string} targetUserId - The user whose info is being requested
 * @returns {Promise<object>} { id, role, fullName, profilePhotoUrl }
 */
export const getUserPublicInfo = async (requesterId, targetUserId) => {
    const user = await prisma.user.findUnique({
        where: { id: targetUserId },
        select: {
            id: true,
            role: true,
            therapistProfile: { select: { fullName: true, profilePhotoUrl: true } },
            customerProfile: { select: { fullName: true, agencyName: true } },
        },
    });

    if (!user) throw new BadRequestError("User not found", "USER_NOT_FOUND");

    const fullName = user.therapistProfile?.fullName || user.customerProfile?.fullName || null;
    const profilePhotoUrl = user.therapistProfile?.profilePhotoUrl || null;

    return { id: user.id, role: user.role, fullName, profilePhotoUrl };
};

/**
 * Get all conversations for a user.
 *
 * Phase 3 rewrite: queries DirectConversations directly instead of the old 6-pass
 * message-assembly algorithm. Every message now has conversationId (Phase 2 backfill),
 * so one query on DirectConversation + latest message gives us the full picture.
 *
 * The "currentContext" badge (booking > offer > direct) is derived from the most recent
 * non-system message that has a bookingId or offerId. If neither exists, it's "direct".
 */
export const getUserConversations = async (userId, callerRole = "customer") => {
    const userSelect = {
        id: true,
        role: true,
        therapistProfile: { select: { id: true, fullName: true, profilePhotoUrl: true, specialization: true, yearsOfExperience: true } },
        customerProfile: { select: { fullName: true, agencyName: true } },
    };

    // 1. Fetch all DirectConversations for this user
    const conversations = await prisma.directConversation.findMany({
        where: {
            OR: [{ user1Id: userId }, { user2Id: userId }],
        },
        include: {
            user1: { select: userSelect },
            user2: { select: userSelect },
        },
    });

    if (conversations.length === 0) return [];

    const conversationIds = conversations.map(c => c.id);

    // 2. Fetch the latest message per conversation (single query, partitioned by conversationId)
    //    Also fetch the latest context-bearing message (bookingId or offerId set) for the badge.
    //    And unread counts per conversation.
    const isCustomer = callerRole === USER_ROLES.CUSTOMER;

    const [latestMessages, unreadCounts, contextMessages, patientMessages] = await Promise.all([
        queryLatestMessagesPerConversation(conversationIds),
        prisma.message.groupBy({
            by: ["conversationId"],
            where: { conversationId: { in: conversationIds }, recipientId: userId, readAt: null, systemType: null },
            _count: { id: true },
        }),
        queryContextMessagesPerConversation(conversationIds),
        isCustomer ? queryPatientMessagesPerConversation(conversationIds) : Promise.resolve([]),
    ]);

    // Build lookup maps
    const lastMsgMap = new Map(latestMessages.map(m => [m.conversationId, m]));
    const unreadMap = new Map(unreadCounts.map(u => [u.conversationId, u._count.id]));
    const contextMap = new Map(contextMessages.map(c => [c.conversationId, c]));
    const patientMap = new Map(patientMessages.map(p => [p.conversationId, p.patientId]));

    // 3. If any conversations have context (offer/booking), fetch those entities for badge data
    const offerIds = new Set();
    const bookingIds = new Set();
    for (const ctx of contextMessages) {
        if (ctx.bookingId) bookingIds.add(ctx.bookingId);
        else if (ctx.offerId) offerIds.add(ctx.offerId);
    }

    const [offers, bookings, patients] = await Promise.all([
        offerIds.size > 0
            ? prisma.offer.findMany({
                where: { id: { in: Array.from(offerIds) } },
                select: { id: true, status: true, rate: true, sessionType: true },
            })
            : [],
        bookingIds.size > 0
            ? prisma.booking.findMany({
                where: { id: { in: Array.from(bookingIds) } },
                select: { id: true, status: true, scheduledDate: true, sessionType: true },
            })
            : [],
        patientMap.size > 0
            ? prisma.patient.findMany({
                where: { id: { in: Array.from(patientMap.values()).filter(Boolean) } },
                select: { id: true, fullName: true },
            })
            : [],
    ]);

    const offerMap = new Map(offers.map(o => [o.id, o]));
    const bookingMap = new Map(bookings.map(b => [b.id, b]));
    const patientDataMap = new Map(patients.map(p => [p.id, p]));

    // 4. Assemble the response
    const result = conversations.map(conv => {
        const otherUser = conv.user1Id === userId ? conv.user2 : conv.user1;
        const lastMsg = lastMsgMap.get(conv.id);
        const unreadCount = unreadMap.get(conv.id) ?? 0;
        const ctx = contextMap.get(conv.id);
        const patientId = isCustomer ? patientMap.get(conv.id) : null;
        const patient = patientId ? patientDataMap.get(patientId) ?? null : null;

        // Determine badge context: booking > offer > direct
        let currentContext;
        if (ctx?.bookingId) {
            const booking = bookingMap.get(ctx.bookingId);
            currentContext = booking
                ? { type: "booking", id: booking.id, data: booking }
                : { type: "direct", id: conv.id, data: null };
        } else if (ctx?.offerId) {
            const offer = offerMap.get(ctx.offerId);
            currentContext = offer
                ? { type: "offer", id: offer.id, data: offer }
                : { type: "direct", id: conv.id, data: null };
        } else {
            currentContext = { type: "direct", id: conv.id, data: null };
        }

        return {
            conversationId: conv.id,
            otherUser,
            patient,
            lastMessage: lastMsg
                ? {
                    id: lastMsg.id,
                    content: lastMsg.systemType ? `[${lastMsg.systemType.replace(/_/g, " ")}]` : lastMsg.content,
                    hasAttachments: lastMsg.hasAttachments === true,
                    senderId: lastMsg.senderId,
                    createdAt: lastMsg.createdAt,
                    readAt: lastMsg.readAt,
                }
                : null,
            currentContext,
            directConversationId: conv.id,
            unreadCount,
            updatedAt: lastMsg?.createdAt ?? conv.updatedAt,
        };
    });

    // Sort by most recent activity, filter out conversations with no messages and no context
    return result
        .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
}

/**
 * Create a direct message — get-or-create DirectConversation + send first message
 * Only customers can initiate; therapists can only reply to existing conversations.
 */
export const createDirectMessage = async ({ senderId, recipientId, content, replyToId }) => {
    if (!content?.trim()) {
        throw new BadRequestError("Message content cannot be empty");
    }

    // Validate sender exists and get their role
    const [sender, recipient] = await Promise.all([
        prisma.user.findUnique({
            where: { id: senderId },
            select: {
                id: true, role: true,
                customerProfile: { select: { customerType: true, onboardingComplete: true } },
            },
        }),
        prisma.user.findUnique({
            where: { id: recipientId },
            select: {
                id: true, role: true,
                therapistProfile: { select: { approvalStatus: true } },
            },
        }),
    ]);

    if (!sender) throw new BadRequestError("Sender not found");
    if (!recipient) throw new BadRequestError("Recipient not found");

    // Access control
    if (sender.role === USER_ROLES.CUSTOMER) {
        if (!sender.customerProfile?.onboardingComplete) {
            throw new AuthorizationError("Your account setup is not complete. Finish onboarding before messaging therapists.");
        }
        if (recipient.role !== "therapist") {
            throw new BadRequestError("Customers can only direct message therapists");
        }
        if (recipient.therapistProfile?.approvalStatus !== APPROVAL_STATUS.APPROVED) {
            throw new BadRequestError("This therapist is not available for messaging");
        }
    } else if (sender.role === USER_ROLES.THERAPIST) {
        // Therapist can only reply — conversation must already exist with messages from customer
        if (recipient.role !== "customer") {
            throw new BadRequestError("Therapists can only direct message customers");
        }
    } else {
        throw new BadRequestError("Only customers and therapists can send direct messages");
    }

    // Normalize user order — smaller UUID as user1 for unique constraint
    const [user1Id, user2Id] = senderId < recipientId
        ? [senderId, recipientId]
        : [recipientId, senderId];

    // Get or create the DirectConversation (race-safe with try/catch on unique constraint)
    let conversation = await prisma.directConversation.findUnique({
        where: { user1Id_user2Id: { user1Id, user2Id } },
    });

    if (!conversation) {
        // Therapists cannot start a new direct conversation
        if (sender.role === USER_ROLES.THERAPIST) {
            throw new AuthorizationError("Therapists cannot initiate direct conversations. The customer must message you first.");
        }

        try {
            conversation = await prisma.directConversation.create({
                data: { user1Id, user2Id },
            });
        } catch (err) {
            // P2002 = unique constraint violation — another request created it first, just fetch it
            if (err.code === "P2002") {
                conversation = await prisma.directConversation.findUnique({
                    where: { user1Id_user2Id: { user1Id, user2Id } },
                });
                if (!conversation) throw new BadRequestError("Failed to create conversation");
            } else {
                throw err;
            }
        }
    } else if (sender.role === USER_ROLES.THERAPIST) {
        // Therapist replying — verify customer has sent at least one message
        const customerMessage = await prisma.message.findFirst({
            where: {
                conversationId: conversation.id,
                senderId: recipientId, // customer is the recipient from therapist's POV
            },
        });
        if (!customerMessage) {
            throw new AuthorizationError("Therapists cannot initiate direct conversations. The customer must message you first.");
        }
    }

    // Use Phase 3 send — conversationId is now the single routing layer
    return sendMessageByConversation(senderId, conversation.id, content, replyToId);
};

