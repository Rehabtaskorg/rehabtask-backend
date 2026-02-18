import { prisma } from "../config/prisma.js"
import { supabase } from "../config/supabase.js";
import { sendEmail } from "../config/email.js";
import { BadRequestError, AuthorizationError } from "../utils/errors.js"

/**
 * Verify user has access to conversation context
 */
export const verifyConversationAccess = async (userId, contextType, contextId) => {
    const accessChecks = {
        request: async () => {
            const request = await prisma.therapyRequest.findFirst({
                where: {
                    id: contextId,
                    OR: [
                        { customer: { userId } },
                        {
                            offers: {
                                some: {
                                    therapist: { userId }
                                }
                            }
                        }
                    ]
                },
                include: {
                    patient: true,
                    customer: true,
                    offers: {
                        include: {
                            therapist: true
                        }
                    }
                }
            });
            return request;
        },

        offer: async () => {
            const offer = await prisma.offer.findFirst({
                where: {
                    id: contextId,
                    OR: [
                        { therapist: { userId } },
                        { request: { customerId: userId } },
                    ],
                },
                include: {
                    request: {
                        include: {
                            patient: true,
                            customer: true,
                        }
                    },
                    therapist: true,
                }
            });
            return offer;
        },

        booking: async () => {
            const booking = await prisma.booking.findFirst({
                where: {
                    id: contextId,
                    OR: [
                        { customer: userId },
                        { therapist: { userId } },
                    ],
                },
                include: {
                    patient: true,
                    customer: true,
                    therapist: true,
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
 * Extract recipient and patient from context
 */
const extractContextMetadata = (userId, contextType, contextData) => {
    let recipientId = null;
    let patientId = null;

    switch (contextType) {
        case "request":
            recipientId = contextData.customer.userId === userId
                ? contextData.offers?.[0]?.therapist?.userId
                : contextData.customer.userId;
            patientId = contextData.patientId;
            break;

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

    if (!["request", "offer", "booking"].includes(contextType)) {
        throw new BadRequestError("Invalid context type");
    }

    const contextData = await verifyConversationAccess(senderId, contextType, contextId);

    const { recipientId, patientId } = extractContextMetadata(senderId, contextType, contextData);

    if (!recipientId) {
        throw new BadRequestError("Cannot determine message recipient");
    }

    const contextField = {
        request: "requestId",
        offer: "offerId",
        booking: "bookingId",
    }[contextType];

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

    // Publish to Supabase Realtime channel
    await publishMessageToRealtime(message, contextType, contextId);

    // Check if recipient is online via Supabase presence
    const isRecipientOnline = await checkUserOnlineStatus(recipientId);

    // // Send email notification if recipient is offline (optional MVP feature)
    // if (!isRecipientOnline) {
    //     await sendMessageEmailNotification(message, contextType).catch(err => {
    //         console.error("Failed to send email notification:", err);
    //         // Don't throw - email is optional
    //     });
    // }

    return message;
};


/**
 * Get conversation messages with pagination
 */
export const getConversationMessages = async (userId, contextType, contextId, options = {}) => {
    const { limit = 50, cursor, order = "desc" } = options;

    await verifyConversationAccess(userId, contextType, contextId);

    const contextField = {
        request: "requestId",
        offer: "offerId",
        booking: "bookingId",
    }[contextType];

    const messages = await prisma.message.findMany({
        where: { [contextField]: contextId },
        orderBy: { createdAt: order },
        take: limit,
        ...(cursor && {
            cursor: { id: cursor },
            skip: 1
        }),
        include: {
            sender: {
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
                    },
                },
            },
        },
    });

    return order === "desc" ? messages.reverse() : messages;
};

/**
 * Mark messages as read in a conversation
 */
export const markMessagesAsRead = async (userId, contextType, contextId) => {
    await verifyConversationAccess(userId, contextType, contextId);

    const contextField = {
        request: "requestId",
        offer: "offerId",
        booking: "bookingId",
    }[contextType];

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
                    therapistProfile: {
                        select: { fullName: true, profilePhotoUrl: true }
                    },
                    customerProfile: {
                        select: { fullName: true, agencyName: true }
                    },
                },
            },
            recipient: {
                select: {
                    id: true,
                    role: true,
                    therapistProfile: {
                        select: { fullName: true, profilePhotoUrl: true }
                    },
                    customerProfile: {
                        select: { fullName: true, agencyName: true }
                    },
                },
            },
            request: {
                select: {
                    id: true,
                    serviceType: true,
                    status: true,
                    location: true,
                    preferredDate: true
                },
            },
            offer: {
                select: {
                    id: true,
                    status: true,
                    rate: true,
                    sessionType: true,
                },
            },
            booking: {
                select: {
                    id: true,
                    status: true,
                    scheduledDate: true,
                    sessionType: true,
                },
            },
            patient: {
                select: {
                    id: true,
                    fullName: true,
                }
            }
        },
    });

    // Query: All unread messages for this user in one shot
    const allUnreadMessages = await prisma.message.findMany({
        where: {
            recipientId: userId,
            readAt: null,
        },
        select: {
            senderId: true,
            patientId: true,
        },
    });

    // Build unread count map in memory — keyed by "otherUserId:patientId"
    // Zero extra DB queries regardless of how many conversations exist
    const unreadCountMap = {};

    for (const unread of allUnreadMessages) {
        const key = `${unread.senderId}:${unread.patientId ?? "none"}`;
        unreadCountMap[key] = (unreadCountMap[key] ?? 0) + 1;
    }

    // Group conversations - zero DB queries inside this loop
    const relationships = new Map();

    for (const msg of userMessages) {
        const otherUserId =
            msg.senderId === userId ? msg.recipientId : msg.senderId;
        const otherUser =
            msg.senderId === userId ? msg.recipient : msg.sender;
        const patientId = msg.patientId ?? "none";

        // Unique key per relationship
        const relationshipKey = `${otherUserId}:${patientId}`;

        if (!relationships.has(relationshipKey)) {
            const currentContext = msg.bookingId
                ? { type: "booking", id: msg.bookingId, data: msg.booking }
                : msg.offerId
                    ? { type: "offer", id: msg.offerId, data: msg.offer }
                    : { type: "request", id: msg.requestId, data: msg.request };

            relationships.set(relationshipKey, {
                otherUser,
                patient: msg.patient,
                lastMessage: {
                    id: msg.id,
                    content: msg.content,
                    senderId: msg.senderId,
                    createdAt: msg.createdAt,
                    readAt: msg.readAt,
                },
                currentContext,
                // Look up from map - no DB call
                unreadCount: unreadCountMap[relationshipKey] ?? 0,
                updatedAt: msg.createdAt,
            });
        }
    }

    // Return sorted by most recent activity
    return Array.from(relationships.values()).sort(
        (a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)
    );
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
}

/**
 * Send email notification for new message
 */
const sendMessageEmailNotification = async (message, contextType) => {
    const senderName =
        message.sender.therapistProfile?.fullName ||
        message.sender.customerProfile?.fullName ||
        "A user";

    const contextLabel = {
        request: "therapy request",
        offer: "offer",
        booking: "booking",
    }[contextType];

    const emailHtml = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2>New Message on RehabTask</h2>
      <p>You have a new message from <strong>${senderName}</strong> regarding your ${contextLabel}.</p>
      
      ${message.patient ? `<p>Patient: <strong>${message.patient.fullName}</strong></p>` : ""}
      
      <div style="background-color: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
        <p style="margin: 0;">${message.content}</p>
      </div>
      
      <p>
        <a href="${process.env.FRONTEND_URL}/messages/${contextType}/${message[`${contextType}Id`]}" 
           style="background-color: #007bff; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; display: inline-block;">
          View Message
        </a>
      </p>
      
      <p style="color: #666; font-size: 12px; margin-top: 30px;">
        You're receiving this because you have notifications enabled for RehabTask.
      </p>
    </div>
  `;

    await sendEmail({
        to: message.recipient.email,
        subject: `New message from ${senderName}`,
        html: emailHtml,
    });
}