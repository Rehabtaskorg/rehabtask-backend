import { prisma } from "../config/prisma.js";
import { NotFoundError, ConflictError } from "../utils/errors.js";
import { logger } from "../config/logger.js";
import { stripe } from "../config/stripe.js";

// Valid sortBy fields for subscriptions
const VALID_SORT_FIELDS = ["createdAt", "currentPeriodStart", "currentPeriodEnd"];

export const adminListSubscriptions = async ({
    status,
    planType,
    search,
    sortBy = "createdAt",
    sortOrder = "desc",
    startDate,
    endDate,
    page = 1,
    limit = 20,
} = {}) => {
    const where = {};
    if (status) where.status = status;
    if (planType) where.planType = planType;

    // Date range filter on createdAt
    if (startDate || endDate) {
        where.createdAt = {};
        if (startDate) {
            where.createdAt.gte = new Date(startDate);
        }
        if (endDate) {
            const end = new Date(endDate);
            end.setUTCHours(23, 59, 59, 999);
            where.createdAt.lte = end;
        }
    }

    // Search by customer name or email
    if (search && search.trim()) {
        const term = search.trim();
        where.customer = {
            OR: [
                { fullName: { contains: term, mode: "insensitive" } },
                { user: { email: { contains: term, mode: "insensitive" } } },
            ],
        };
    }

    // Guard against invalid sort field
    const resolvedSortBy = VALID_SORT_FIELDS.includes(sortBy) ? sortBy : "createdAt";
    const orderBy = { [resolvedSortBy]: sortOrder === "asc" ? "asc" : "desc" };

    const [subscriptions, total] = await Promise.all([
        prisma.subscription.findMany({
            where,
            include: {
                customer: {
                    select: {
                        id: true,
                        fullName: true,
                        customerType: true,
                        user: { select: { id: true, email: true } },
                    },
                },
            },
            orderBy,
            skip: (page - 1) * limit,
            take: limit,
        }),
        prisma.subscription.count({ where }),
    ]);

    return {
        subscriptions,
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
};

export const adminGetSubscription = async (subscriptionId) => {
    const subscription = await prisma.subscription.findUnique({
        where: { id: subscriptionId },
        include: {
            customer: {
                include: {
                    user: { select: { id: true, email: true } },
                },
            },
        },
    });
    if (!subscription) throw new NotFoundError("Subscription not found");
    return subscription;
};

export const adminCancelSubscription = async (subscriptionId, adminId) => {
    const subscription = await prisma.subscription.findUnique({
        where: { id: subscriptionId },
    });
    if (!subscription) throw new NotFoundError("Subscription not found");
    if (subscription.status === "cancelled") {
        throw new ConflictError("Subscription is already cancelled");
    }

    if (subscription.stripeSubscriptionId) {
        try {
            await stripe.subscriptions.cancel(subscription.stripeSubscriptionId);
        } catch (stripeError) {
            logger.error("[AdminSubscriptionService] Stripe cancel failed", {
                subscriptionId,
                error: stripeError.message,
            });
            throw stripeError;
        }
    }

    const updated = await prisma.subscription.update({
        where: { id: subscriptionId },
        data: { status: "cancelled" },
    });

    logger.info("[AdminSubscriptionService] Subscription cancelled", {
        subscriptionId,
        byAdmin: adminId,
    });
    return updated;
};

export const adminGetSubscriptionStats = async () => {
    const [total, active, inactive, cancelled, pastDue, byPlan] = await Promise.all([
        prisma.subscription.count(),
        prisma.subscription.count({ where: { status: "active" } }),
        prisma.subscription.count({ where: { status: "inactive" } }),
        prisma.subscription.count({ where: { status: "cancelled" } }),
        prisma.subscription.count({ where: { status: "past_due" } }),
        prisma.subscription.groupBy({
            by: ["planType"],
            _count: { id: true },
            where: { status: "active" },
        }),
    ]);

    return {
        total,
        active,
        inactive,
        cancelled,
        pastDue,
        byPlan: byPlan.reduce((acc, row) => {
            acc[row.planType] = row._count.id;
            return acc;
        }, {}),
    };
};
