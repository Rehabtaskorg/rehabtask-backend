import { USER_ROLES, APPROVAL_STATUS, BOOKING_STATUS } from "../utils/constants.js";
import { prisma } from "../config/prisma.js"
import { sendNewMessageNotification } from "./email.service.js";
import { logger } from "../config/logger.js";
import { BadRequestError, AuthorizationError } from "../utils/errors.js"
import { logAction } from "./audit.service.js";
import { getIO } from "../socket/index.js";
import { isUserOnline } from "../socket/presence.js";

/**
 * Generate the booking divider text based on the booking's current status.
 */
const getBookingDividerText = (bookingStatus) => {
    switch (bookingStatus) {
        case "confirmed":
        case "in_progress":
            return "Offer accepted — Session confirmed.";
        case "completed":
            return "Offer accepted — Session completed.";
        case "cancelled":
            return "Offer accepted — Booking cancelled.";
        default:
            // accepted or pending — payment not yet made
            return "Offer accepted — Booking created. Awaiting payment.";
    }
};

/**
 * Emit an event to a Socket.io room.
 * Safe to call even if Socket.io is not initialized (e.g., during tests).
 */
const emitToRoom = (room, event, payload) => {
    const io = getIO();
    if (!io) return;
    io.to(room).emit(event, payload);
};

/**
 * Verify user has access to conversation context
 */
export const verifyConversationAccess = async (userId, contextType, contextId) => {
    const accessChecks = {
        offer: async () => {
            const offer = await prisma.offer.findFirst({
                where: {
                    id: contextId,
                    OR: [
                        { therapist: { userId } },
                        { request: { customer: { userId } } },
                    ],
                },
                include: {
                    therapist: true,
                    request: {
                        include: {
                            customer: true,
                            patient: true,
                        }
                    },
                }
            });
            return offer;
        },

        booking: async () => {
            const booking = await prisma.booking.findFirst({
                where: {
                    id: contextId,
                    OR: [
                        { customer: { userId } },
                        { therapist: { userId } },
                    ],
                },
                include: {
                    patient: true,
                    customer: true,
                    therapist: true,
                    offer: true
                }
            });
            return booking;
        },

        direct: async () => {
            const userSelect = {
                id: true, role: true,
                therapistProfile: { select: { id: true, fullName: true, profilePhotoUrl: true, specialization: true, yearsOfExperience: true } },
                customerProfile: { select: { fullName: true, agencyName: true } },
            };

            // First try: contextId is a DirectConversation UUID
            const conversation = await prisma.directConversation.findFirst({
                where: {
                    id: contextId,
                    OR: [
                        { user1Id: userId },
                        { user2Id: userId },
                    ],
                },
                include: { user1: { select: userSelect }, user2: { select: userSelect } },
            });
            if (conversation) return conversation;

            // Second try: contextId is a userId (for pending direct conversations with no record yet)
            // Only allow if the requesting user is a customer and the target is an approved therapist,
            // or if a DirectConversation already exists (handled above). This prevents info leaks.
            const otherUser = await prisma.user.findFirst({
                where: { id: contextId },
                select: { ...userSelect, therapistProfile: { select: { ...userSelect.therapistProfile.select, approvalStatus: true } } },
            });
            if (otherUser) {
                // Only allow customers to look up approved therapists for pending direct
                const requestingUser = await prisma.user.findUnique({
                    where: { id: userId },
                    select: { role: true },
                });
                const isCustomerToApprovedTherapist =
                    requestingUser?.role === USER_ROLES.CUSTOMER &&
                    otherUser.role === USER_ROLES.THERAPIST &&
                    otherUser.therapistProfile?.approvalStatus === APPROVAL_STATUS.APPROVED;

                if (!isCustomerToApprovedTherapist) return null;

                return { _isPendingDirect: true, user1Id: userId, user2Id: contextId, user1: null, user2: otherUser };
            }

            return null;
        },
    }

    const contextData = await accessChecks[contextType]?.();

    if (!contextData) {
        throw new AuthorizationError("Access denied to this conversation");
    }

    return contextData;
}

/**
 * Get the other party's info for an empty/new conversation
 */
export const getConversationContext = async (userId, contextType, contextId) => {
    const contextData = await verifyConversationAccess(userId, contextType, contextId);

    let otherUser = null;
    let patient = null;

    switch (contextType) {
        case "offer":
            otherUser = contextData.request.customer.userId === userId
                ? contextData.therapist
                : contextData.request.customer;
            patient = contextData.request.patient ?? null;
            break;

        case "booking":
            otherUser = contextData.customer.userId === userId
                ? contextData.therapist
                : contextData.customer;
            patient = contextData.patient ?? null;
            break;

        case "direct": {
            const rawOther = contextData.user1Id === userId
                ? contextData.user2
                : contextData.user1;
            // Normalize to the same shape as offer/booking (profile-level object)
            // so the frontend gets consistent { fullName, profilePhotoUrl, ... } structure
            if (rawOther?.therapistProfile) {
                otherUser = {
                    ...rawOther.therapistProfile,
                    userId: rawOther.id,
                    role: rawOther.role,
                };
            } else if (rawOther?.customerProfile) {
                otherUser = {
                    ...rawOther.customerProfile,
                    userId: rawOther.id,
                    role: rawOther.role,
                };
            } else {
                otherUser = rawOther;
            }
            break;
        }
    }

    return { otherUser, patient };
}

/**
 * Extract recipient and patient from context
 */
const extractContextMetadata = (userId, contextType, contextData) => {
    let recipientId = null;
    let patientId = null;

    switch (contextType) {
        case "offer":
            recipientId = contextData.request.customer.userId === userId
                ? contextData.therapist.userId
                : contextData.request.customer.userId;
            patientId = contextData.request.patientId;
            break;

        case "booking":
            recipientId = contextData.customer.userId === userId
                ? contextData.therapist.userId
                : contextData.customer.userId;
            patientId = contextData.patientId;
            break;

        case "direct":
            recipientId = contextData.user1Id === userId
                ? contextData.user2Id
                : contextData.user1Id;
            break;
    }

    return { recipientId, patientId }
}

/**
 * Find or create a DirectConversation for a user pair.
 * Normalizes user order (smaller UUID = user1) for the unique constraint.
 * Race-safe: catches unique constraint violations and fetches the existing row.
 */
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
 * Create a new message
 */
export const createMessage = async ({ senderId, content, contextType, contextId, replyToId, _preVerifiedContextData }) => {
    if (!content?.trim()) {
        throw new BadRequestError("Message content cannot be empty");
    }

    if (!["offer", "booking", "direct"].includes(contextType)) {
        throw new BadRequestError("Invalid context type");
    }

    // Allow callers that already verified access (e.g. createDirectMessage) to skip the redundant check
    const contextData = _preVerifiedContextData ?? await verifyConversationAccess(senderId, contextType, contextId);

    const { recipientId, patientId } = extractContextMetadata(senderId, contextType, contextData);

    if (!recipientId) {
        throw new BadRequestError("Cannot determine message recipient");
    }

    if (senderId === recipientId) {
        throw new BadRequestError("Cannot send messages to yourself");
    }

    const contextField = {
        offer: "offerId",
        booking: "bookingId",
        direct: "conversationId",
    }[contextType];

    // Anti-spam: only notify on the first unread in this conversation
    // If the recipient already has unread messages here, they're aware
    const existingUnreadCount = await prisma.message.count({
        where: {
            [contextField]: contextId,
            recipientId,
            readAt: null
        },
    });
    const shouldEmailNotify = existingUnreadCount === 0;

    // Dual-write: for offer/booking messages, also link to the DirectConversation
    // so Phase 3 can read all messages from one place. Direct messages already have conversationId.
    let dualWriteConversationId = null;
    if (contextType === "offer" || contextType === "booking") {
        try {
            const conversation = await findOrCreateDirectConversation(senderId, recipientId);
            dualWriteConversationId = conversation.id;
        } catch (err) {
            // Non-fatal: dual-write failure should not block the message
            logger.warn("[MessageService] Dual-write: failed to find/create DirectConversation", { error: err.message, senderId, recipientId });
        }
    }

    // Validate reply target belongs to the same conversation before creating the message.
    // Without this check a user could reply to a message from a different conversation.
    if (replyToId) {
        const replyTarget = await prisma.message.findUnique({ where: { id: replyToId } });
        if (!replyTarget) {
            throw new BadRequestError("Reply target message not found", "REPLY_TARGET_NOT_FOUND");
        }
        const isSameContext =
            (contextType === "direct"  && replyTarget.conversationId === contextId) ||
            (contextType === "offer"   && replyTarget.offerId         === contextId) ||
            (contextType === "booking" && replyTarget.bookingId       === contextId);
        if (!isSameContext) {
            throw new BadRequestError("Cannot reply to a message from a different conversation", "REPLY_TARGET_CONTEXT_MISMATCH");
        }
    }

    const message = await prisma.message.create({
        data: {
            senderId,
            recipientId,
            content: content.trim(),
            [contextField]: contextId,
            ...(patientId && { patientId }),
            ...(dualWriteConversationId && { conversationId: dualWriteConversationId }),
            ...(replyToId && { replyToId }),
        }, include: {
            sender: {
                select: {
                    id: true,
                    email: true,
                    role: true,
                    therapistProfile: {
                        select: {
                            fullName: true,
                            profilePhotoUrl: true
                        }
                    },
                    customerProfile: {
                        select: {
                            fullName: true,
                            agencyName: true,
                        },
                    },
                },
            },
            recipient: {
                select: {
                    id: true,
                    email: true,
                    role: true,
                }
            },
            patient: {
                select: {
                    id: true,
                    fullName: true,
                }
            }
        },
    });

    // Event: message.sent
    logAction({
        actorId: senderId,
        action: "message.sent",
        entityType: "message",
        entityId: message.id,
        changes: { contextType, contextId, recipientId },
    });

    await publishMessageToRealtime(message, contextType, contextId);

    const isRecipientOnline = await checkUserOnlineStatus(recipientId);

    // // Send email notification if recipient is offline and no existing unread
    if (!isRecipientOnline && shouldEmailNotify) {
        const senderName =
            message.sender.therapistProfile?.fullName ||
            message.sender.customerProfile?.fullName ||
            "A user";

        sendNewMessageNotification({
            recipient: message.recipient,
            senderName,
            message,
            contextType,
            contextId
        }).catch((err) => {
            logger.error('[MessageService] Email notification failed', { error: err.message });
        })
    }

    return message;
};

/**
 * Get conversation messages by conversationId.
 * Phase 3 rewrite: single query on conversationId — no stitching, no context merging.
 * System dividers are stored as real Message rows with systemType set.
 */
export const getConversationMessagesByConvId = async (userId, conversationId, options = {}) => {
    const { limit = 50, cursor, order = "desc" } = options;

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
 * Get conversation messages with pagination (LEGACY — kept for backward compatibility)
 * New code should use getConversationMessagesByConvId() instead.
 */
export const getConversationMessages = async (userId, contextType, contextId, options = {}) => {
    const { limit = 50, cursor, order = "desc" } = options;

    const contextData = await verifyConversationAccess(userId, contextType, contextId);

    const contextField = {
        offer: "offerId",
        booking: "bookingId",
        direct: "conversationId",
    }[contextType];

    const senderSelect = {
        select: {
            id: true,
            role: true,
            therapistProfile: {
                select: {
                    fullName: true,
                    profilePhotoUrl: true
                },
            },
            customerProfile: {
                select: {
                    fullName: true,
                    agencyName: true,
                },
            }
        }
    };

    // For a direct context, stitch direct + offer + booking messages between the same user pair
    if (contextType === "direct") {
        const otherUserId = contextData.user1Id === userId
            ? contextData.user2Id
            : contextData.user1Id;

        // Shared WHERE clause for all message types between this user pair
        const cursorFilter = cursor
            ? { createdAt: { lt: (await prisma.message.findUnique({ where: { id: cursor }, select: { createdAt: true } }))?.createdAt } }
            : {};

        // Fetch direct messages
        const directMessages = await prisma.message.findMany({
            where: { conversationId: contextId, ...cursorFilter },
            orderBy: { createdAt: "desc" },
            take: limit,
            include: { sender: senderSelect },
        });

        // Find all offers between these two users
        const offers = await prisma.offer.findMany({
            where: {
                OR: [
                    { therapist: { userId: otherUserId }, request: { customer: { userId } } },
                    { therapist: { userId }, request: { customer: { userId: otherUserId } } },
                ],
            },
            select: { id: true, createdAt: true, status: true, booking: { select: { id: true, createdAt: true, status: true } } },
            orderBy: { createdAt: "asc" },
        });

        // Fetch offer messages and booking messages (with same cursor and limit)
        const offerIds = offers.map(o => o.id);
        const bookingIds = offers.filter(o => o.booking).map(o => o.booking.id);

        const [offerMessages, bookingMessages] = await Promise.all([
            offerIds.length > 0
                ? prisma.message.findMany({
                    where: { offerId: { in: offerIds }, ...cursorFilter },
                    orderBy: { createdAt: "desc" },
                    take: limit,
                    include: { sender: senderSelect, offer: { select: { id: true } } },
                })
                : [],
            bookingIds.length > 0
                ? prisma.message.findMany({
                    where: { bookingId: { in: bookingIds }, ...cursorFilter },
                    orderBy: { createdAt: "desc" },
                    take: limit,
                    include: { sender: senderSelect, booking: { select: { id: true } } },
                })
                : [],
        ]);

        // Tag and merge all messages chronologically
        const tagged = [
            ...directMessages.map(m => ({ ...m, _context: "direct" })),
            ...offerMessages.map(m => ({ ...m, _context: "offer" })),
            ...bookingMessages.map(m => ({ ...m, _context: "booking" })),
        ];
        tagged.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

        // Insert system dividers at context transitions
        const stitched = [];
        let currentContext = null;

        // Build a map of offer → booking for divider insertion
        const offerToBooking = new Map();
        for (const offer of offers) {
            if (offer.booking) offerToBooking.set(offer.id, offer.booking);
        }

        // Track which dividers we've already inserted
        const insertedDividers = new Set();

        for (const msg of tagged) {
            // Insert "Offer sent" divider when entering offer context (from direct or as first message)
            if (msg._context === "offer" && currentContext !== "offer" && msg.offer?.id && !insertedDividers.has(`offer:${msg.offer.id}`)) {
                insertedDividers.add(`offer:${msg.offer.id}`);
                stitched.push({
                    id: `system:offer-sent:${msg.offer.id}`,
                    type: "system",
                    content: "Offer sent",
                    createdAt: msg.createdAt,
                    _context: "offer",
                });
            }

            // Insert "Booking created" divider when transitioning to booking context
            if (msg._context === "booking" && currentContext !== "booking" && msg.booking?.id && !insertedDividers.has(`booking:${msg.booking.id}`)) {
                insertedDividers.add(`booking:${msg.booking.id}`);
                const booking = bookingIds.length > 0
                    ? offers.find(o => o.booking?.id === msg.booking.id)?.booking
                    : null;
                stitched.push({
                    id: `system:booking-created:${msg.booking.id}`,
                    type: "system",
                    content: getBookingDividerText(booking?.status),
                    createdAt: booking?.createdAt ?? msg.createdAt,
                    _context: "booking",
                });
            }

            stitched.push(msg);
            currentContext = msg._context;
        }

        // Ensure all offers have their dividers (even if no messages exist in that context yet)
        for (const offer of offers) {
            // Always insert "Offer sent" divider if not already present
            if (!insertedDividers.has(`offer:${offer.id}`)) {
                insertedDividers.add(`offer:${offer.id}`);
                stitched.push({
                    id: `system:offer-sent:${offer.id}`,
                    type: "system",
                    content: "Offer sent",
                    createdAt: offer.createdAt,
                    _context: "offer",
                });
            }

            // Insert "Booking created" divider if booking exists but no booking messages yet
            if (offer.booking && !insertedDividers.has(`booking:${offer.booking.id}`)) {
                insertedDividers.add(`booking:${offer.booking.id}`);
                stitched.push({
                    id: `system:booking-created:${offer.booking.id}`,
                    type: "system",
                    content: getBookingDividerText(offer.booking.status),
                    createdAt: offer.booking.createdAt,
                    _context: "booking",
                });
            }
        }

        // Re-sort after post-loop divider insertions to maintain chronological order
        stitched.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

        // Apply limit: take only the most recent `limit` real messages (plus their dividers)
        // Count real messages (non-system) to determine if there are more
        const realMessages = stitched.filter(m => m.type !== "system");
        const totalRealMessages = realMessages.length;

        if (totalRealMessages > limit) {
            // Keep only the last `limit` real messages and their surrounding dividers
            const cutoffDate = realMessages[totalRealMessages - limit].createdAt;
            const trimmed = stitched.filter(m => new Date(m.createdAt) >= new Date(cutoffDate));
            trimmed._totalRealMessages = totalRealMessages;
            return trimmed;
        }

        stitched._totalRealMessages = totalRealMessages;
        return stitched;
    }

    // For a booking context, stitch offer messages + booking messages together
    if (contextType === "booking") {
        const offerId = contextData.offer?.id;

        const cursorFilterBooking = cursor
            ? { createdAt: { lt: (await prisma.message.findUnique({ where: { id: cursor }, select: { createdAt: true } }))?.createdAt } }
            : {};

        const [offerMessages, bookingMessages] = await Promise.all([
            offerId
                ? prisma.message.findMany({
                    where: { offerId, ...cursorFilterBooking },
                    orderBy: { createdAt: "desc" },
                    take: limit,
                    include: { sender: senderSelect },
                })
                : Promise.resolve([]),
            prisma.message.findMany({
                where: { bookingId: contextId, ...cursorFilterBooking },
                orderBy: { createdAt: "desc" },
                take: limit,
                include: { sender: senderSelect },
            }),
        ]);

        const taggedOffer = offerMessages.map(m => ({ ...m, _context: "offer" }));
        const taggedBooking = bookingMessages.map(m => ({ ...m, _context: "booking" }));

        // Merge and sort chronologically
        const allMessages = [...taggedOffer, ...taggedBooking];
        allMessages.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

        // Take only the last `limit` real messages
        const trimmedMessages = allMessages.length > limit
            ? allMessages.slice(allMessages.length - limit)
            : allMessages;

        // Build the stitched thread with divider
        const stitched = [];

        // Only add offer messages that survived trimming
        const offerInTrimmed = trimmedMessages.filter(m => m._context === "offer");
        const bookingInTrimmed = trimmedMessages.filter(m => m._context === "booking");

        if (offerInTrimmed.length > 0) {
            stitched.push(...offerInTrimmed);
        }

        // Inject the system divider when the offer thread exists
        if (offerId) {
            stitched.push({
                id: `system:booking-created:${contextId}`,
                type: "system",
                content: getBookingDividerText(contextData.status),
                createdAt: contextData.createdAt,
                _context: "booking",
            });
        }

        stitched.push(...bookingInTrimmed);

        stitched._totalRealMessages = allMessages.length;
        return stitched;
    }

    // Standard single-context fetch (offer or future types)
    const messages = await prisma.message.findMany({
        where: { [contextField]: contextId },
        orderBy: { createdAt: order },
        take: limit,
        ...(cursor && {
            cursor: { id: cursor },
            skip: 1
        }),
        include: { sender: senderSelect },
    });

    const sorted = order === "desc" ? messages.reverse() : messages;

    // For offer context, inject the offer widget divider at the top
    if (contextType === "offer") {
        const offer = await prisma.offer.findUnique({
            where: { id: contextId },
            select: { id: true, createdAt: true, booking: { select: { id: true, createdAt: true, status: true } } },
        });
        if (offer) {
            const dividers = [
                {
                    id: `system:offer-sent:${offer.id}`,
                    type: "system",
                    content: "Offer sent",
                    createdAt: offer.createdAt,
                    _context: "offer",
                },
            ];
            if (offer.booking) {
                dividers.push({
                    id: `system:booking-created:${offer.booking.id}`,
                    type: "system",
                    content: getBookingDividerText(offer.booking.status),
                    createdAt: offer.booking.createdAt,
                    _context: "booking",
                });
            }
            // Insert dividers at the correct chronological positions
            const all = [...dividers, ...sorted];
            all.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
            return all;
        }
    }

    return sorted;
};

/**
 * Mark all messages as read in a conversation by conversationId.
 * Phase 3: single update, no cascading across contexts.
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
 * Mark messages as read in a conversation (LEGACY — kept for backward compatibility)
 */
export const markMessagesAsRead = async (userId, contextType, contextId) => {
    const contextData = await verifyConversationAccess(userId, contextType, contextId);

    const contextField = {
        offer: "offerId",
        booking: "bookingId",
        direct: "conversationId",
    }[contextType];

    // Mark messages as read
    const result = await prisma.message.updateMany({
        where: {
            [contextField]: contextId,
            recipientId: userId,
            readAt: null,
        },
        data: {
            readAt: new Date(),
        },
    });

    // For bookings, also mark the parent offer's messages as read
    if (contextType === "booking" && contextData.offer?.id) {
        await prisma.message.updateMany({
            where: {
                offerId: contextData.offer.id,
                recipientId: userId,
                readAt: null,
            },
            data: { readAt: new Date() },
        });
    }

    // For direct conversations, also mark related offer/booking messages as read
    // but ONLY for offers/bookings that exist between this specific user pair
    if (contextType === "direct") {
        const otherUserId = contextData.user1Id === userId
            ? contextData.user2Id
            : contextData.user1Id;

        // Find offers between these two users specifically
        const relatedOffers = await prisma.offer.findMany({
            where: {
                OR: [
                    { therapist: { userId: otherUserId }, request: { customer: { userId } } },
                    { therapist: { userId }, request: { customer: { userId: otherUserId } } },
                ],
            },
            select: { id: true, booking: { select: { id: true } } },
        });

        const relatedOfferIds = relatedOffers.map(o => o.id);
        const relatedBookingIds = relatedOffers.filter(o => o.booking).map(o => o.booking.id);

        if (relatedOfferIds.length > 0 || relatedBookingIds.length > 0) {
            await prisma.message.updateMany({
                where: {
                    senderId: otherUserId,
                    recipientId: userId,
                    readAt: null,
                    OR: [
                        ...(relatedOfferIds.length > 0 ? [{ offerId: { in: relatedOfferIds } }] : []),
                        ...(relatedBookingIds.length > 0 ? [{ bookingId: { in: relatedBookingIds } }] : []),
                    ],
                },
                data: { readAt: new Date() },
            });
        }
    }


    // Publish read receipt to the OTHER user (the sender of the messages that were just read)
    // They need to know their messages have been seen — the reader already knows.
    if (result.count > 0) {
        const { recipientId: otherUserId } = extractContextMetadata(userId, contextType, contextData);
        if (otherUserId) {
            emitToRoom(`user:${otherUserId}`, "messages:marked_read", {
                contextType,
                contextId,
                readBy: userId,
                count: result.count,
            });
        }
    }

    return result.count;
}

/**
 * Get unread message count for a user
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
        // Latest message per conversation
        prisma.$queryRaw`
            SELECT DISTINCT ON (conversation_id)
                id, sender_id AS "senderId", content, created_at AS "createdAt",
                read_at AS "readAt", conversation_id AS "conversationId", system_type AS "systemType",
                EXISTS (
                    SELECT 1 FROM message_attachments WHERE message_id = messages.id
                ) AS "hasAttachments"
            FROM messages
            WHERE conversation_id = ANY(${conversationIds}::uuid[])
            ORDER BY conversation_id, created_at DESC
        `,
        // Unread counts per conversation
        prisma.message.groupBy({
            by: ["conversationId"],
            where: {
                conversationId: { in: conversationIds },
                recipientId: userId,
                readAt: null,
                systemType: null,
            },
            _count: { id: true },
        }),
        // Latest context-bearing message per conversation (for badge: booking > offer > direct)
        prisma.$queryRaw`
            SELECT DISTINCT ON (conversation_id)
                conversation_id AS "conversationId",
                offer_id AS "offerId",
                booking_id AS "bookingId",
                patient_id AS "patientId"
            FROM messages
            WHERE conversation_id = ANY(${conversationIds}::uuid[])
              AND (offer_id IS NOT NULL OR booking_id IS NOT NULL)
            ORDER BY conversation_id, created_at DESC
        `,
        // Patient info only for customers — therapists must not see patient PHI
        isCustomer
            ? prisma.$queryRaw`
                SELECT DISTINCT ON (conversation_id)
                    conversation_id AS "conversationId",
                    patient_id AS "patientId"
                FROM messages
                WHERE conversation_id = ANY(${conversationIds}::uuid[])
                  AND patient_id IS NOT NULL
                ORDER BY conversation_id, created_at DESC
              `
            : Promise.resolve([]),
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
export const createDirectMessage = async ({ senderId, recipientId, content }) => {
    if (!content?.trim()) {
        throw new BadRequestError("Message content cannot be empty");
    }

    // Validate sender exists and get their role
    const [sender, recipient] = await Promise.all([
        prisma.user.findUnique({
            where: { id: senderId },
            select: { id: true, role: true },
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
        // Customer can message any approved therapist
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

    // Create the message — pass pre-verified context to skip redundant verifyConversationAccess
    const preVerified = {
        user1Id: conversation.user1Id ?? (senderId < recipientId ? senderId : recipientId),
        user2Id: conversation.user2Id ?? (senderId < recipientId ? recipientId : senderId),
    };

    return createMessage({
        senderId,
        content,
        contextType: "direct",
        contextId: conversation.id,
        _preVerifiedContextData: preVerified,
    });
};

/**
 * Publish message to connected clients via Socket.io
 */
const publishMessageToRealtime = async (message, contextType, contextId) => {
    try {
        const payload = { ...message, _contextType: contextType, _contextId: contextId };

        // Emit to new room format (Phase 3: conversation:{conversationId})
        if (message.conversationId) {
            emitToRoom(`conversation:${message.conversationId}`, "message:new", payload);
        }

        // Also emit to legacy room format (kept for backward compat during rollout)
        emitToRoom(`conversation:${contextType}:${contextId}`, "message:new", payload);

        // Also emit to recipient's personal room so they get the message
        // regardless of which page they're on (dashboard, bookings, etc.)
        emitToRoom(`user:${message.recipientId}`, "message:new", payload);

        const unreadCount = await getUnreadCount(message.recipientId);
        emitToRoom(`user:${message.recipientId}`, "message:unread_update", { count: unreadCount });
    } catch (error) {
        logger.error("[Socket] Message broadcast error:", error);
    }
};

/**
 * Check is user is currently only via Supabase presence
 */
const checkUserOnlineStatus = async (userId) => {
    return isUserOnline(userId);
};
