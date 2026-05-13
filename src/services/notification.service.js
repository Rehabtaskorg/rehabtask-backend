import { prisma } from "../config/prisma.js";
import { logger } from "../config/logger.js";
import { NOTIFICATION_DEDUP_WINDOW_MS } from "../utils/constants.js";

const DEDUP_WINDOW_MS = NOTIFICATION_DEDUP_WINDOW_MS;

/**
 * Internal: returns true if an identical (non-failed notification)
 * was created for this user+type+entityId within the deep window.
 */
const isDuplicate = async (userId, type, entityId) => {
    const since = new Date(Date.now() - DEDUP_WINDOW_MS);
    const existing = await prisma.notification.findFirst({
        where: {
            userId,
            type,
            entityId: entityId ?? null,
            createdAt: { gte: since },
            failed: false
        },
    });
    return !!existing;
}

/**
 * Create a single in-app notification. Never throws
 * Returns the created notification, or null on failure
 */
export const createNotification = async ({
    userId,
    type,
    title,
    message,
    entityType = null,
    entityId = null,
    metadata = null,
    skipDedup = false
}) => {
    try {
        if (!skipDedup) {
            const duplicate = await isDuplicate(userId, type, entityId);
            if (duplicate) {
                logger.info("[NotificationService] Dedup skip", { userId, type, entityId });
                return null;
            }
        }

        const notification = await prisma.notification.create({
            data: {
                userId,
                type,
                title,
                message,
                entityType,
                entityId,
                metadata,
                sentAt: new Date(),
                failed: false,
            },
        });

        return notification;

    } catch (error) {
        logger.error("[NotificationService] Failed to create notification", {
            userId,
            type,
            error: error.message,
        });

        // Persist failure record for observability - best effort
        try {
            await prisma.notification.create({
                data: {
                    userId,
                    type,
                    title,
                    message,
                    entityType,
                    entityId,
                    metadata,
                    sentAt: new Date(),
                    failed: true,
                },
            });

        } catch {
            // DB may be unavailable — silently ignore
        }
    }
}

/**
 * Send the same notification to multiple users concurrently
 */
export const createBulkNotifications = async (notifications) => {
    return Promise.allSettled(notifications.map((n) => createNotification(n)));
}

/**
 * Mark a single notification as read (scoped to the owning user)
 */
export const markAsRead = async (notificationId, userId) => {
    return prisma.notification.updateMany({
        where: { id: notificationId, userId },
        data: { isRead: true }
    });
}

/**
 * Mark every unread notification for a user as read
 */
export const markAllAsRead = async (userId) => {
    return prisma.notification.updateMany({
        where: { userId, isRead: false },
        data: { isRead: true },
    });
}

/**
 * Get paginated notifications for a user, with an unread count.
 */
export const getUserNotifications = async (
    userId,
    { page = 1, limit = 20, unreadOnly = false }
) => {
    const where = { userId, failed: false };
    if (unreadOnly) where.isRead = false;

    const [notifications, total, unreadCount] = await Promise.all([
        prisma.notification.findMany({
            where,
            orderBy: { createdAt: "desc" },
            skip: (page - 1) * limit,
            take: limit,
        }),
        prisma.notification.count({ where }),
        prisma.notification.count({ where: { userId, isRead: false, failed: false } }),
    ]);

    return {
        notifications,
        unreadCount,
        pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit),
        },
    };
}

/**
 * Admin: list all notifications with optional filters.
 */
export const getAllNotifications = async ({
    userId,
    type,
    failed,
    page = 1,
    limit = 20,
} = {}) => {
    const where = {};
    if (userId) where.userId = userId;
    if (type) where.type = type;
    if (typeof failed === "boolean") where.failed = failed;

    const [notifications, total] = await Promise.all([
        prisma.notification.findMany({
            where,
            include: {
                user: {
                    select: {
                        id: true,
                        email: true,
                        role: true,
                        customerProfile: { select: { fullName: true } },
                        therapistProfile: { select: { fullName: true } },
                    },
                },
            },
            orderBy: { createdAt: "desc" },
            skip: (page - 1) * limit,
            take: limit,
        }),
        prisma.notification.count({ where }),
    ]);

    return {
        notifications,
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
};

/**
 * Admin: broadcast a notification to every active user with a given role
 */
export const broadcastNotification = async ({
    role,
    type,
    title,
    message,
    metadata = null,
}) => {
    const where = { isActive: true };
    if (role !== "all") where.role = role;

    const users = await prisma.user.findMany({
        where,
        select: { id: true },
    });

    if (users.length === 0) return { sent: 0 };

    const notifications = users.map((u) => ({
        userId: u.id,
        type,
        title,
        message,
        metadata,
        skipDedup: true,
    }));


    await createBulkNotifications(notifications);

    return { sent: users.length };
}