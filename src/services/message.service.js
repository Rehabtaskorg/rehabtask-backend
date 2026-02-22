import { prisma } from "../config/prisma.js"
import { supabase } from "../config/supabase.js";
import { sendNewMessageNotification } from "./email.service.js";
import { logger } from "../config/logger.js";
import { BadRequestError, AuthorizationError } from "../utils/errors.js"

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
    }

    return { recipientId, patientId }
}

/**
 * Create a new message
 */
export const createMessage = async ({ senderId, content, contextType, contextId }) => {
    if (!content?.trim()) {
        throw new BadRequestError("Message content cannot be empty");
    }

    if (!["offer", "booking"].includes(contextType)) {
        throw new BadRequestError("Invalid context type");
    }

    const contextData = await verifyConversationAccess(senderId, contextType, contextId);

    const { recipientId, patientId } = extractContextMetadata(senderId, contextType, contextData);

    if (!recipientId) {
        throw new BadRequestError("Cannot determine message recipient");
    }

    const contextField = {
        offer: "offerId",
        booking: "bookingId",
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

    // For a booking context, stitch offer messages + booking messages together
    if (contextType === "booking") {
        const offerId = contextData.offer?.id;

        const [offerMessages, bookingMessages] = await Promise.all([
            offerId
                ? prisma.message.findMany({
                    where: { offerId },
                    orderBy: { createdAt: "asc" },
                    include: { sender: senderSelect },
                })
                : Promise.resolve([]),
            prisma.message.findMany({
                where: { bookingId: contextId },
                orderBy: { createdAt: "asc" },
                include: { sender: senderSelect },
            }),
        ]);

        const taggedOffer = offerMessages.map(m => ({ ...m, _context: "offer" }));
        const taggedBooking = bookingMessages.map(m => ({ ...m, _context: "booking" }));

        // Build the stitched thread
        const stitched = [];

        if (taggedOffer.length > 0) {
            stitched.push(...taggedOffer);
        }

        // Inject the system divider between the 2 threads only when both sides have context, or when the offer thread exists at all
        // (so the customer can see the transition even if they haven't messaged yet after booking)
        if (offerId) {
            stitched.push({
                id: `system:booking-created:${contextId}`,
                type: "system",                         // frontend uses this to render a divider
                content: "Offer accepted — Booking created",
                createdAt: contextData.createdAt,       // booking creation timestamp
                _context: "booking",
            });
        }

        stitched.push(...taggedBooking);

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

    return order === "desc" ? messages.reverse() : messages;
};

/**
 * Mark messages as read in a conversation
 */
export const markMessagesAsRead = async (userId, contextType, contextId) => {
    const contextData = await verifyConversationAccess(userId, contextType, contextId);

    const contextField = {
        offer: "offerId",
        booking: "bookingId",
    }[contextType];

    // Mark bookings messages are read
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


    // Publish read receipt to realtime
    if (result.count > 0) {
        await supabase
            .channel(`user:${userId}`)
            .send({
                type: "broadcast",
                event: "messages:marked_read",
                payload: {
                    contextType,
                    contextId,
                    count: result.count
                },
            });
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
    // Query: All messages for this user
    const userMessages = await prisma.message.findMany({
        where: {
            OR: [
                { senderId: userId },
                { recipientId: userId },
            ],
        },
        orderBy: { createdAt: "desc" },
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

    // Query: All unread messages for this user has received
    const allUnreadMessages = await prisma.message.findMany({
        where: { recipientId: userId, readAt: null, },
        select: { senderId: true, patientId: true, offerId: true },
    });

    const unreadCountMap = {};
    for (const unread of allUnreadMessages) {
        const key = `${unread.senderId}:${unread.patientId ?? "none"}`;
        unreadCountMap[key] = (unreadCountMap[key] ?? 0) + 1;
    }

    const relationships = new Map();

    for (const msg of userMessages) {
        const otherUserId = msg.senderId === userId ? msg.recipientId : msg.senderId;
        const otherUser = msg.senderId === userId ? msg.recipient : msg.sender;
        const patientId = msg.patientId ?? "none";

        const relationshipKey = `${otherUserId}:${patientId}`;

        const msgContextPriority = msg.bookingId ? 2 : 1;

        if (!relationships.has(relationshipKey)) {
            const currentContext = msg.bookingId
                ? { type: "booking", id: msg.bookingId, data: msg.booking }
                : { type: "offer", id: msg.offerId, data: msg.offer };

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
                unreadCount: unreadCountMap[relationshipKey] ?? 0,
                updatedAt: msg.createdAt,
            });
        } else {
            const existing = relationships.get(relationshipKey);

            if (msg.offerId) existing._offerIds.add(msg.offerId);

            if (msgContextPriority > existing._contextPriority) {
                existing.currentContext = msg.bookingId
                    ? { type: "booking", id: msg.bookingId, data: msg.booking }
                    : { type: "offer", id: msg.offerId, data: msg.offer };
                existing._contextPriority = msgContextPriority;
            }
        }
    }

    // Post pass: upgrade offer-only conversations that have a booking
    // This handles the case where an offer was accepted and a booking exists
    // but no messages have been sent in the booking context yet.
    const offerOnlyConversations = Array.from(relationships.values()).filter(
        (conv) => conv._contextPriority < 2 && conv._offerIds.size > 0
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
                    conv._contextPriority = 2;
                    break; // one booking per offer
                }
            }
        }
    }

    // Booking pass: include bookings with no message yet
    const userBookings = await prisma.booking.findMany({
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
    });

    for (const booking of userBookings) {
        const isCurrentUserCustomer = booking.customer.userId === userId;
        const otherUserId = isCurrentUserCustomer
            ? booking.therapist.userId
            : booking.customer.userId;
        const patientId = booking.patientId ?? "none";
        const relationshipKey = `${otherUserId}:${patientId}`;

        if (relationships.has(relationshipKey)) continue; // already covered by messages

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
            _contextPriority: 2,
            _offerIds: new Set(booking.offerId ? [booking.offerId] : []),
            unreadCount: 0,
            updatedAt: booking.updatedAt,
        });
    }

    // Offer pass: Include active offers with no messages and no booking yet
    const userOffers = await prisma.offer.findMany({
        where: {
            status: { in: ["pending", "accepted"] },
            booking: null, // only offers that haven't converted to a booking
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
    });

    for (const offer of userOffers) {
        const isCurrentUserTherapist = offer.therapist.userId === userId;
        const otherUserId = isCurrentUserTherapist
            ? offer.request.customer.userId
            : offer.therapist.userId;
        const patientId = offer.request.patientId ?? "none";
        const relationshipKey = `${otherUserId}:${patientId}`;

        if (relationships.has(relationshipKey)) continue;

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
            _contextPriority: 1,
            _offerIds: new Set([offer.id]),
            unreadCount: 0,
            updatedAt: offer.updatedAt,
        });
    }

    return Array.from(relationships.values())
        .map(({ _contextPriority, _offerIds, ...rest }) => rest)
        .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
}

/**
 * Publish message to Supabase Realtime
 */
const publishMessageToRealtime = async (message, contextType, contextId) => {
    try {
        const channelName = `conversation:${contextType}:${contextId}`;

        await supabase
            .channel(channelName)
            .send({
                type: "broadcast",
                event: "message:new",
                payload: message
            });

        const unreadCount = await getUnreadCount(message.recipientId);

        await supabase
            .channel(`user:${message.recipientId}`)
            .send({
                type: "broadcast",
                event: "message:unread_update",
                payload: { count: unreadCount }
            });
    } catch (error) {
        console.error("Supabase realtime publish error:", error);
        // Don't throw - realtime is not critical
    }
};

/**
 * Check is user is currently only via Supabase presence
 */
const checkUserOnlineStatus = async (_userId) => {
    // TODO: Implement proper Supabase presence tracking post-MVP
    return false;
};