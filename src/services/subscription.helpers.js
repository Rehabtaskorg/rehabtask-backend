import { prisma } from "../config/prisma.js";
import { stripe } from "../config/stripe.js";
import { logger } from "../config/logger.js";

/**
 * Safely parse a Stripe timestamp to a Date.
 * Handles Unix timestamps (seconds), ISO strings, and Date objects.
 * @param {number|string|Date|null} value
 * @returns {Date|null}
 */
export const parseStripeDate = (value) => {
    if (!value) return null;
    if (typeof value === "number") return new Date(value * 1000);
    if (typeof value === "string") return new Date(value);
    if (value instanceof Date) return value;
    return null;
};

/**
 * Release a pending Stripe Subscription Schedule and clear it from the DB.
 * Falls back to checking Stripe directly if stripeScheduleId is not in the DB
 * (handles orphan schedules from failed create+update sequences).
 * @param {object} subscription - DB subscription record
 */
export const releaseScheduleIfPending = async (subscription) => {
    let scheduleId = subscription.stripeScheduleId;

    if (!scheduleId) {
        const stripeSub = await stripe.subscriptions.retrieve(subscription.stripeSubscriptionId);
        scheduleId = stripeSub.schedule ?? null;
    }

    if (!scheduleId) return;

    await stripe.subscriptionSchedules.release(scheduleId);
    await prisma.subscription.update({
        where: { id: subscription.id },
        data: { stripeScheduleId: null },
    });

    logger.info("[Subscription] Released existing schedule", { subscriptionId: subscription.id, scheduleId });
};
