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
                therapistProfile: { select: { fullName: true, profilePhotoUrl: true, specialization: true, yearsOfExperience: true } },
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
                    requestingUser?.role === "customer" &&
                    otherUser.role === "therapist" &&
                    otherUser.therapistProfile?.approvalStatus === "approved";

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
 * Create a new message
 */
export const createMessage = async ({ senderId, content, contextType, contextId, _preVerifiedContextData }) => {
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

    const message = await prisma.message.create({
        data: {
            senderId,
            recipientId,
            content: content.trim(),
            [contextField]: contextId,
            ...(patientId && { patientId }),
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
 * Get conversation messages with pagination
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
 * Mark messages as read in a conversation
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
 * Get all conversations for a user
 */
export const getUserConversations = async (userId) => {
    // Query: Recent messages for this user — we only need the latest per conversation context,
    // so cap at a reasonable limit to avoid loading thousands of rows for power users.
    const userMessages = await prisma.message.findMany({
        where: {
            OR: [
                { senderId: userId },
                { recipientId: userId },
            ],
        },
        orderBy: { createdAt: "desc" },
        take: 500,
        include: {
            sender: {
                select: {
                    id: true,
                    role: true,
                    therapistProfile: { select: { fullName: true, profilePhotoUrl: true } },
                    customerProfile: { select: { fullName: true, agencyName: true } },
                },
            },
            recipient: {
                select: {
                    id: true,
                    role: true,
                    therapistProfile: { select: { fullName: true, profilePhotoUrl: true } },
                    customerProfile: { select: { fullName: true, agencyName: true } },
                },
            },
            offer: {
                select: { id: true, status: true, rate: true, sessionType: true, },
            },
            booking: {
                select: { id: true, status: true, scheduledDate: true, sessionType: true, },
            },
            patient: {
                select: { id: true, fullName: true, }
            },
        },
    });

    // Query: Unread counts — use groupBy aggregation instead of loading every unread message
    const unreadGroups = await prisma.message.groupBy({
        by: ["senderId", "patientId"],
        where: { recipientId: userId, readAt: null },
        _count: { id: true },
    });

    const unreadCountMap = {};
    for (const group of unreadGroups) {
        const key = `${group.senderId}:${group.patientId ?? "none"}`;
        unreadCountMap[key] = (unreadCountMap[key] ?? 0) + group._count.id;
    }

    const relationships = new Map();

    for (const msg of userMessages) {
        const otherUserId = msg.senderId === userId ? msg.recipientId : msg.senderId;
        const otherUser = msg.senderId === userId ? msg.recipient : msg.sender;
        const patientId = msg.patientId ?? "none";

        const relationshipKey = `${otherUserId}:${patientId}`;

        const msgContextPriority = msg.bookingId ? 3 : msg.offerId ? 2 : 1;

        if (!relationships.has(relationshipKey)) {
            let currentContext;
            if (msg.bookingId) {
                currentContext = { type: "booking", id: msg.bookingId, data: msg.booking };
            } else if (msg.offerId) {
                currentContext = { type: "offer", id: msg.offerId, data: msg.offer };
            } else if (msg.conversationId) {
                currentContext = { type: "direct", id: msg.conversationId, data: null };
            } else {
                continue; // orphan message, skip
            }

            relationships.set(relationshipKey, {
                otherUser,
                patient: msg.patient ?? null,
                lastMessage: {
                    id: msg.id,
                    content: msg.content,
                    senderId: msg.senderId,
                    createdAt: msg.createdAt,
                    readAt: msg.readAt,
                },
                currentContext,
                _contextPriority: msgContextPriority,
                _offerIds: new Set(msg.offerId ? [msg.offerId] : []),
                _directConvId: msg.conversationId ?? null,
                unreadCount: unreadCountMap[relationshipKey] ?? 0,
                updatedAt: msg.createdAt,
            });
        } else {
            const existing = relationships.get(relationshipKey);

            if (msg.offerId) existing._offerIds.add(msg.offerId);
            if (msg.conversationId && !existing._directConvId) {
                existing._directConvId = msg.conversationId;
            }

            if (msgContextPriority > existing._contextPriority) {
                if (msg.bookingId) {
                    existing.currentContext = { type: "booking", id: msg.bookingId, data: msg.booking };
                } else if (msg.offerId) {
                    existing.currentContext = { type: "offer", id: msg.offerId, data: msg.offer };
                }
                existing._contextPriority = msgContextPriority;
            }
        }
    }

    // Post pass: upgrade offer-only conversations that have a booking
    // This handles the case where an offer was accepted and a booking exists
    // but no messages have been sent in the booking context yet.
    const offerOnlyConversations = Array.from(relationships.values()).filter(
        (conv) => conv._contextPriority < 3 && conv._offerIds.size > 0
    );

    if (offerOnlyConversations.length > 0) {
        const allOfferIds = new Set();
        for (const conv of offerOnlyConversations) {
            for (const oid of conv._offerIds) allOfferIds.add(oid);
        }

        // Find bookings that were created from these offers
        const bookingsFromOffers = await prisma.booking.findMany({
            where: { offerId: { in: Array.from(allOfferIds) } },
            select: {
                id: true,
                offerId: true,
                status: true,
                scheduledDate: true,
                sessionType: true,
            }
        });

        // Build offerId → booking map
        const offerToBooking = new Map();
        for (const booking of bookingsFromOffers) {
            offerToBooking.set(booking.offerId, booking);
        }

        // Upgrade conversations whose offer now has a booking
        for (const conv of offerOnlyConversations) {
            for (const oid of conv._offerIds) {
                const booking = offerToBooking.get(oid);
                if (booking) {
                    conv.currentContext = {
                        type: "booking",
                        id: booking.id,
                        data: {
                            id: booking.id,
                            status: booking.status,
                            scheduledDate: booking.scheduledDate,
                            sessionType: booking.sessionType,
                        },
                    };
                    conv._contextPriority = 3;
                    break; // one booking per offer
                }
            }
        }
    }

    // Run bookings, offers, and direct conversation queries in parallel (they're independent)
    const [userBookings, userOffers, directConversations] = await Promise.all([
        prisma.booking.findMany({
            where: {
                status: { not: "cancelled" },
                OR: [
                    { customer: { userId } },
                    { therapist: { userId } },
                ]
            },
            select: {
                id: true,
                status: true,
                scheduledDate: true,
                sessionType: true,
                patientId: true,
                offerId: true,
                updatedAt: true,
                patient: { select: { id: true, fullName: true } },
                customer: { select: { userId: true, fullName: true, agencyName: true } },
                therapist: { select: { userId: true, fullName: true, profilePhotoUrl: true } },
            }
        }),
        prisma.offer.findMany({
            where: {
                status: { in: ["pending", "accepted"] },
                booking: null,
                OR: [
                    { therapist: { userId } },
                    { request: { customer: { userId } } },
                ],
            },
            select: {
                id: true,
                status: true,
                rate: true,
                sessionType: true,
                updatedAt: true,
                request: {
                    select: {
                        patientId: true,
                        patient: { select: { id: true, fullName: true } },
                        customer: { select: { userId: true, fullName: true, agencyName: true } },
                    },
                },
                therapist: { select: { userId: true, fullName: true, profilePhotoUrl: true } },
            },
        }),
        prisma.directConversation.findMany({
            where: {
                OR: [
                    { user1Id: userId },
                    { user2Id: userId },
                ],
            },
            include: {
                user1: {
                    select: {
                        id: true, role: true,
                        therapistProfile: { select: { fullName: true, profilePhotoUrl: true } },
                        customerProfile: { select: { fullName: true, agencyName: true } },
                    },
                },
                user2: {
                    select: {
                        id: true, role: true,
                        therapistProfile: { select: { fullName: true, profilePhotoUrl: true } },
                        customerProfile: { select: { fullName: true, agencyName: true } },
                    },
                },
            },
        }),
    ]);

    // Booking pass: include bookings with no message yet
    // If a relationship entry already exists (e.g. from direct/offer messages), upgrade its priority
    for (const booking of userBookings) {
        const isCurrentUserCustomer = booking.customer.userId === userId;
        const otherUserId = isCurrentUserCustomer
            ? booking.therapist.userId
            : booking.customer.userId;
        const patientId = booking.patientId ?? "none";
        const relationshipKey = `${otherUserId}:${patientId}`;

        if (relationships.has(relationshipKey)) {
            // Entry exists — upgrade to booking context if higher priority
            const existing = relationships.get(relationshipKey);
            if (booking.offerId) existing._offerIds.add(booking.offerId);
            if (3 > existing._contextPriority) {
                existing.currentContext = {
                    type: "booking",
                    id: booking.id,
                    data: {
                        id: booking.id,
                        status: booking.status,
                        scheduledDate: booking.scheduledDate,
                        sessionType: booking.sessionType,
                    },
                };
                existing._contextPriority = 3;
            }
            if (!existing.patient && booking.patient) {
                existing.patient = booking.patient;
            }
            continue;
        }

        const otherUserProfile = isCurrentUserCustomer ? booking.therapist : booking.customer;

        relationships.set(relationshipKey, {
            otherUser: {
                id: otherUserId,
                role: isCurrentUserCustomer ? "therapist" : "customer",
                therapistProfile: isCurrentUserCustomer
                    ? { fullName: otherUserProfile.fullName, profilePhotoUrl: otherUserProfile.profilePhotoUrl }
                    : null,
                customerProfile: !isCurrentUserCustomer
                    ? { fullName: otherUserProfile.fullName, agencyName: otherUserProfile.agencyName }
                    : null,
            },
            patient: booking.patient ?? null,
            lastMessage: null,
            currentContext: {
                type: "booking",
                id: booking.id,
                data: {
                    id: booking.id,
                    status: booking.status,
                    scheduledDate: booking.scheduledDate,
                    sessionType: booking.sessionType,
                },
            },
            _contextPriority: 3,
            _offerIds: new Set(booking.offerId ? [booking.offerId] : []),
            _directConvId: null,
            unreadCount: 0,
            updatedAt: booking.updatedAt,
        });
    }

    // Offer pass: Include active offers with no messages and no booking yet
    // If a relationship entry already exists (e.g. from direct messages), upgrade its priority
    for (const offer of userOffers) {
        const isCurrentUserTherapist = offer.therapist.userId === userId;
        const otherUserId = isCurrentUserTherapist
            ? offer.request.customer.userId
            : offer.therapist.userId;
        const patientId = offer.request.patientId ?? "none";
        const relationshipKey = `${otherUserId}:${patientId}`;

        if (relationships.has(relationshipKey)) {
            // Entry exists (e.g. from direct messages) — upgrade to offer context if higher priority
            const existing = relationships.get(relationshipKey);
            existing._offerIds.add(offer.id);
            if (2 > existing._contextPriority) {
                existing.currentContext = {
                    type: "offer",
                    id: offer.id,
                    data: {
                        id: offer.id,
                        status: offer.status,
                        rate: offer.rate,
                        sessionType: offer.sessionType,
                    },
                };
                existing._contextPriority = 2;
            }
            // Fill in patient data if the existing entry doesn't have it
            if (!existing.patient && offer.request.patient) {
                existing.patient = offer.request.patient;
            }
            continue;
        }

        const otherUserProfile = isCurrentUserTherapist
            ? offer.request.customer
            : offer.therapist;

        relationships.set(relationshipKey, {
            otherUser: {
                id: otherUserId,
                role: isCurrentUserTherapist ? "customer" : "therapist",
                therapistProfile: !isCurrentUserTherapist
                    ? { fullName: otherUserProfile.fullName, profilePhotoUrl: otherUserProfile.profilePhotoUrl }
                    : null,
                customerProfile: isCurrentUserTherapist
                    ? { fullName: otherUserProfile.fullName, agencyName: otherUserProfile.agencyName }
                    : null,
            },
            patient: offer.request.patient ?? null,
            lastMessage: null,
            currentContext: {
                type: "offer",
                id: offer.id,
                data: {
                    id: offer.id,
                    status: offer.status,
                    rate: offer.rate,
                    sessionType: offer.sessionType,
                },
            },
            _contextPriority: 2,
            _offerIds: new Set([offer.id]),
            _directConvId: null,
            unreadCount: 0,
            updatedAt: offer.updatedAt,
        });
    }

    // Direct conversation pass: Include direct conversations with no messages yet
    for (const conv of directConversations) {
        const otherUserId = conv.user1Id === userId ? conv.user2Id : conv.user1Id;
        const relationshipKey = `${otherUserId}:none`;

        // Check if ANY entry for this otherUserId exists (with any patient) — attach directConvId
        // This prevents duplicate entries when the same user has both direct + patient-linked conversations
        let attachedToExisting = false;
        for (const [key, existing] of relationships.entries()) {
            if (key.startsWith(`${otherUserId}:`)) {
                if (!existing._directConvId) existing._directConvId = conv.id;
                if (!existing.directConversationId) existing.directConversationId = conv.id;
                attachedToExisting = true;
                // Don't break — attach to ALL entries for this user (multiple patients)
            }
        }
        if (attachedToExisting) continue;

        const otherUser = conv.user1Id === userId ? conv.user2 : conv.user1;

        relationships.set(relationshipKey, {
            otherUser,
            patient: null,
            lastMessage: null,
            currentContext: { type: "direct", id: conv.id, data: null },
            _contextPriority: 1,
            _offerIds: new Set(),
            _directConvId: conv.id,
            unreadCount: 0,
            updatedAt: conv.updatedAt,
        });
    }

    // Merge pass: absorb "direct-only" (:none) entries into patient-specific entries
    // for the same otherUserId. This ensures one conversation per user pair (merged threads).
    // Without this, agency customers see duplicate entries: one for direct chat and one for
    // the offer/booking (which has a patientId).
    const noneKeys = [];
    for (const [key] of relationships) {
        if (key.endsWith(":none")) noneKeys.push(key);
    }

    for (const noneKey of noneKeys) {
        const otherUserId = noneKey.split(":")[0];
        const noneEntry = relationships.get(noneKey);

        // Find the highest-priority entry for this user with an actual patient
        let bestKey = null;
        let bestEntry = null;
        for (const [k, v] of relationships) {
            if (k === noneKey) continue;
            if (k.startsWith(`${otherUserId}:`)) {
                if (!bestEntry || v._contextPriority > bestEntry._contextPriority) {
                    bestKey = k;
                    bestEntry = v;
                }
            }
        }

        if (bestEntry) {
            // Absorb directConvId
            if (noneEntry._directConvId) {
                bestEntry._directConvId = noneEntry._directConvId;
                bestEntry.directConversationId = noneEntry._directConvId;
            }
            // Keep the more recent lastMessage
            if (noneEntry.lastMessage) {
                if (!bestEntry.lastMessage || new Date(noneEntry.lastMessage.createdAt) > new Date(bestEntry.lastMessage.createdAt)) {
                    bestEntry.lastMessage = noneEntry.lastMessage;
                    bestEntry.updatedAt = noneEntry.updatedAt;
                }
            }
            // Merge unread counts
            bestEntry.unreadCount = (bestEntry.unreadCount ?? 0) + (noneEntry.unreadCount ?? 0);

            relationships.delete(noneKey);
        }
    }

    // For conversations that have a direct conversation, always include the directConversationId
    // so the frontend can use it for the merged thread view
    return Array.from(relationships.values())
        .map(({ _contextPriority, _offerIds, _directConvId, ...rest }) => ({
            ...rest,
            ..._directConvId ? { directConversationId: _directConvId } : {},
        }))
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
    if (sender.role === "customer") {
        // Customer can message any approved therapist
        if (recipient.role !== "therapist") {
            throw new BadRequestError("Customers can only direct message therapists");
        }
        if (recipient.therapistProfile?.approvalStatus !== "approved") {
            throw new BadRequestError("This therapist is not available for messaging");
        }
    } else if (sender.role === "therapist") {
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
        if (sender.role === "therapist") {
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
    } else if (sender.role === "therapist") {
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

        // Emit to conversation room (for users actively viewing this thread)
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
