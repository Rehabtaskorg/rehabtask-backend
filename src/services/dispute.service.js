import { USER_ROLES } from "../utils/constants.js";
import { prisma } from "../config/prisma.js";
import {
    NotFoundError,
    BadRequestError,
    AuthorizationError
} from "../utils/errors.js";
import { logAction } from "./audit.service.js";

const generateTicketId = () => {
    const prefix = "RT";
    const timestamp = Date.now().toString(36).toUpperCase();
    const random = Math.random().toString(36).substring(2, 6).toUpperCase();
    return `${prefix}-${timestamp}-${random}`;
}

export const createDispute = async (userId, data) => {
    const { bookingId, type, description } = data;

    if (bookingId) {
        const booking = await prisma.booking.findUnique({
            where: { id: bookingId },
            include: {
                customer: { select: { userId: true } },
                therapist: { select: { userId: true } },
            },
        });

        if (!booking) throw new NotFoundError("Booking not found");

        const isParty =
            booking.customer.userId === userId ||
            booking.therapist.userId === userId;

        if (!isParty) {
            throw new AuthorizationError(
                "You can only create disputes for bookings you are a party to"
            );
        }
    }

    // Retry loop to handler rare ticketId collisions (P2002)
    const MAX_RETRIES = 3;
    let attempt = 0;

    while (attempt < MAX_RETRIES) {
        try {
            const ticketId = generateTicketId();

            const dispute = await prisma.dispute.create({
                data: {
                    ticketId,
                    userId,
                    bookingId: bookingId || null,
                    type,
                    description,
                    status: "open"
                }
            });

            // Event: session.disputed
            logAction({
                actorId: userId,
                action: "session.disputed",
                entityType: "dispute",
                entityId: dispute.id,
                changes: { ticketId, bookingId: bookingId || null, type },
            });

            return dispute;
        } catch (error) {
            // P2002 = unique constraint violation (duplicate ticketId)
            if (error.code === "P2002" && attempt < MAX_RETRIES - 1) {
                attempt++;
                continue;
            }
            throw error;
        }
    }
};

export const getUserDisputes = async (userId) => {
    const disputes = await prisma.dispute.findMany({
        where: { userId },
        include: {
            booking: {
                select: {
                    scheduledDate: true,
                    sessionType: true,
                    status: true,
                },
            },
        },
        orderBy: { createdAt: "desc" },
    });

    return disputes;
}

export const getDisputeById = async (disputeId, userId, userRole) => {
    const dispute = await prisma.dispute.findUnique({
        where: { id: disputeId },
        include: {
            booking: {
                select: {
                    id: true,
                    scheduledDate: true,
                    sessionType: true,
                    status: true,
                },
            },
        },
    });

    if (!dispute) throw new NotFoundError("Dispute not found");

    if (userRole !== USER_ROLES.ADMIN && dispute.userId !== userId) {
        throw new AuthorizationError("You do not have access to this dispute");
    }

    return dispute;
}

export const getAllDisputes = async ({ status, page, limit }) => {
    const where = {};
    if (status) where.status = status;

    const [disputes, total] = await Promise.all([
        prisma.dispute.findMany({
            where,
            include: {
                user: {
                    select: {
                        email: true,
                        role: true,
                    },
                },
                booking: {
                    select: {
                        scheduledDate: true,
                        sessionType: true,
                        status: true,
                    },
                },
            },
            orderBy: { createdAt: "desc" },
            skip: (page - 1) * limit,
            take: limit,
        }),
        prisma.dispute.count({ where }),
    ]);

    return {
        disputes,
        pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit),
        },
    };
};

export const resolveDispute = async (disputeId, adminUserId, data) => {
    const existing = await prisma.dispute.findUnique({
        where: { id: disputeId },
    });

    if (!existing) throw new NotFoundError("Dispute not found");

    const updatedData = {
        status: data.status,
        resolution: data.resolution || existing.resolution,
    };

    if (data.status === "resolved" || data.status === "closed") {
        updatedData.resolvedAt = new Date();
        updatedData.resolvedBy = adminUserId;
    }

    const dispute = await prisma.dispute.update({
        where: { id: disputeId },
        data: updatedData,
    });

    // Event: admin.review_opened (admin resolved/updated dispute)
    logAction({
        actorId: adminUserId,
        action: "admin.review_opened",
        entityType: "dispute",
        entityId: disputeId,
        changes: { status: data.status, resolution: data.resolution || null, previousStatus: existing.status },
    });

    return dispute;
}