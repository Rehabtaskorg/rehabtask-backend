import { SUBSCRIPTION_STATUS, BOOKING_STATUS, PLAN_TYPES } from "../utils/constants.js";
import { prisma } from "../config/prisma.js";
import { NotFoundError, ConflictError } from "../utils/errors.js";
import { logger } from "../config/logger.js";
import { stripe } from "../config/stripe.js";
import { sendSubscriptionCancelledByAdmin } from "./email.service.js";
import { PLAN_CONFIG } from "../config/subscriptionPlans.js";

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

    // Date range filter — applies to whichever field is being sorted
    const dateField = VALID_SORT_FIELDS.includes(sortBy) ? sortBy : "createdAt";
    if (startDate || endDate) {
        where[dateField] = {};
        if (startDate) {
            where[dateField].gte = new Date(startDate);
        }
        if (endDate) {
            const end = new Date(endDate);
            end.setUTCHours(23, 59, 59, 999);
            where[dateField].lte = end;
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
        include: {
            customer: {
                select: {
                    fullName: true,
                    user: { select: { email: true } },
                },
            },
        },
    });
    if (!subscription) throw new NotFoundError("Subscription not found");
    if (subscription.status === BOOKING_STATUS.CANCELLED) {
        throw new ConflictError("Subscription is already cancelled");
    }

    // Trial/free subscriptions: downgrade to free (no Stripe involved)
    if (!subscription.stripeSubscriptionId) {
        const updated = await prisma.subscription.update({
            where: { id: subscriptionId },
            data: {
                status: SUBSCRIPTION_STATUS.ACTIVE,
                planType: PLAN_TYPES.FREE,
                visitLimit: PLAN_CONFIG[PLAN_TYPES.FREE].visitLimit ?? 999999,
                jobPostingLimit: PLAN_CONFIG[PLAN_TYPES.FREE].jobPostingLimit ?? 999999,
                trialEndsAt: null,
                gracePeriodEndsAt: null,
            },
        });

        sendSubscriptionCancelledByAdmin({
            customer: subscription.customer,
            subscription: updated,
        }).catch(() => {});

        logger.info("[AdminSubscriptionService] Trial/free subscription ended by admin", {
            subscriptionId,
            byAdmin: adminId,
            previousStatus: subscription.status,
        });
        return updated;
    }

    // Paid subscriptions: cancel in Stripe first
    try {
        await stripe.subscriptions.cancel(subscription.stripeSubscriptionId);
    } catch (stripeError) {
        logger.error("[AdminSubscriptionService] Stripe cancel failed", {
            subscriptionId,
            error: stripeError.message,
        });
        throw stripeError;
    }

    const updated = await prisma.subscription.update({
        where: { id: subscriptionId },
        data: { status: BOOKING_STATUS.CANCELLED },
    });

    sendSubscriptionCancelledByAdmin({
        customer: subscription.customer,
        subscription: updated,
    }).catch(() => {});

    logger.info("[AdminSubscriptionService] Subscription cancelled", {
        subscriptionId,
        byAdmin: adminId,
    });
    return updated;
};

export const adminGetSubscriptionStats = async () => {
    const [total, active, inactive, cancelled, pastDue, trialing, gracePeriod, byPlan] = await Promise.all([
        prisma.subscription.count(),
        prisma.subscription.count({ where: { status: SUBSCRIPTION_STATUS.ACTIVE } }),
        prisma.subscription.count({ where: { status: SUBSCRIPTION_STATUS.INACTIVE } }),
        prisma.subscription.count({ where: { status: BOOKING_STATUS.CANCELLED } }),
        prisma.subscription.count({ where: { status: SUBSCRIPTION_STATUS.PAST_DUE } }),
        prisma.subscription.count({ where: { status: SUBSCRIPTION_STATUS.TRIALING } }),
        prisma.subscription.count({ where: { status: SUBSCRIPTION_STATUS.GRACE_PERIOD } }),
        prisma.subscription.groupBy({
            by: ["planType"],
            _count: { id: true },
            where: { status: { in: [SUBSCRIPTION_STATUS.ACTIVE, SUBSCRIPTION_STATUS.TRIALING, SUBSCRIPTION_STATUS.GRACE_PERIOD] } },
        }),
    ]);

    return {
        total,
        active,
        inactive,
        cancelled,
        pastDue,
        trialing,
        gracePeriod,
        byPlan: byPlan.reduce((acc, row) => {
            acc[row.planType] = row._count.id;
            return acc;
        }, {}),
    };
};
