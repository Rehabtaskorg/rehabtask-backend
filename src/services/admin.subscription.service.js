import { prisma } from "../config/prisma.js";
import { NotFoundError, ConflictError } from "../utils/errors.js";
import { logger } from "../config/logger.js";
import { stripe } from "../config/stripe.js";

export const adminListSubscriptions = async ({
    status,
    planType,
    page = 1,
    limit = 20,
} = {}) => {
    const where = {};
    if (status) where.status = status;
    if (planType) where.planType = planType;

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
            orderBy: { createdAt: "desc" },
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
    const [total, active, cancelled, pastDue, byPlan] = await Promise.all([
        prisma.subscription.count(),
        prisma.subscription.count({ where: { status: "active" } }),
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
        cancelled,
        pastDue,
        byPlan: byPlan.reduce((acc, row) => {
            acc[row.planType] = row._count.id;
            return acc;
        }, {}),
    };
};
