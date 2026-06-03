import { SUBSCRIPTION_STATUS } from "../utils/constants.js";
import { prisma } from "../config/prisma.js";
import { sendTrialExpired, sendSubscriptionDowngraded } from "./email.service.js";
import { logger } from "../config/logger.js";
import { PLAN_CONFIG } from "../config/subscriptionPlans.js";
import { logSystemEvent } from "./audit.service.js";

/**
 * Downgrade expired trials to the free plan.
 * Runs on a schedule — finds all trialing subscriptions past their trialEndsAt date.
 */
export const runTrialExpiry = async () => {
    const expired = await prisma.subscription.findMany({
        where: {
            status: SUBSCRIPTION_STATUS.TRIALING,
            trialEndsAt: { lte: new Date() },
        },
        include: { customer: { include: { user: true } } },
    });

    if (expired.length === 0) return;

    const { requestLimit, therapistLimit } = PLAN_CONFIG.free;

    for (const sub of expired) {
        await prisma.subscription.update({
            where: { id: sub.id },
            data: {
                status: SUBSCRIPTION_STATUS.ACTIVE,
                planType: "free",
                trialEndsAt: null,
                therapistLimit,
                requestLimit,
            },
        });

        logSystemEvent({
            action: "subscription.trial_expired",
            entityType: "subscription",
            entityId: sub.id,
            changes: { customerId: sub.customerId, previousPlan: "standard", downgradedTo: "free" },
        });

        try {
            await sendTrialExpired({ customer: sub.customer });
        } catch (err) {
            logger.error("[Subscription] Failed to send trial expired email", { error: err.message });
        }

        logger.info("[Subscription] Trial expired — downgraded to free", {
            subscriptionId: sub.id, customerId: sub.customerId,
        });
    }

    logger.info(`[Subscription] Trial expiry check: ${expired.length} downgraded`);
};

/**
 * Downgrade expired grace periods to the free plan.
 * Runs on a schedule — finds all grace_period subscriptions past their gracePeriodEndsAt date.
 */
export const runGracePeriodExpiry = async () => {
    const expired = await prisma.subscription.findMany({
        where: {
            status: SUBSCRIPTION_STATUS.GRACE_PERIOD,
            gracePeriodEndsAt: { lte: new Date() },
        },
        include: { customer: { include: { user: true } } },
    });

    if (expired.length === 0) return;

    const { requestLimit, therapistLimit } = PLAN_CONFIG.free;

    for (const sub of expired) {
        await prisma.subscription.update({
            where: { id: sub.id },
            data: {
                status: SUBSCRIPTION_STATUS.ACTIVE,
                planType: "free",
                gracePeriodEndsAt: null,
                stripeSubscriptionId: null,
                stripePriceId: null,
                billingInterval: null,
                therapistLimit,
                requestLimit,
            },
        });

        logSystemEvent({
            action: "subscription.grace_period_expired",
            entityType: "subscription",
            entityId: sub.id,
            changes: { customerId: sub.customerId, previousPlan: sub.planType, downgradedTo: "free" },
        });

        try {
            await sendSubscriptionDowngraded({ customer: sub.customer });
        } catch (err) {
            logger.error("[Subscription] Failed to send downgrade email", { error: err.message });
        }

        logger.info("[Subscription] Grace period expired — downgraded to free", {
            subscriptionId: sub.id, customerId: sub.customerId,
        });
    }

    logger.info(`[Subscription] Grace period expiry check: ${expired.length} downgraded`);
};
