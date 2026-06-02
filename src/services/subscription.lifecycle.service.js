import { SUBSCRIPTION_STATUS, BOOKING_STATUS } from "../utils/constants.js";
import { NotFoundError } from "../utils/errors.js";
import { prisma } from "../config/prisma.js";
import { stripe } from "../config/stripe.js";
import { getOrCreateStripeCustomer } from "./payment.service.js";
import {
    sendSubscriptionCancelledByCustomer,
    sendSubscriptionUpgraded,
} from "./email.service.js";
import { logger } from "../config/logger.js";
import { PLAN_CONFIG, getStripePriceId, getPlanFromPriceId, TRIAL_DURATION_DAYS } from "../config/subscriptionPlans.js";
import { logSystemEvent } from "./audit.service.js";
import { trackServerEvent } from "../config/posthog.js";
import { TIME_MS } from "../utils/constants.js";
import { parseStripeDate, releaseScheduleIfPending } from "./subscription.helpers.js";

/**
 * Create a trial subscription for a new customer.
 * Called during registration inside the withAdminAccess transaction.
 * @param {string} customerId
 * @param {object} [tx] - Prisma transaction client
 */
export const createTrialSubscription = async (customerId, tx = prisma) => {
    const trialEndsAt = new Date(Date.now() + TRIAL_DURATION_DAYS * TIME_MS.TWENTY_FOUR_HOURS);
    const { requestLimit, therapistLimit } = PLAN_CONFIG.standard;

    return tx.subscription.create({
        data: {
            customerId,
            planType: "standard",
            status: SUBSCRIPTION_STATUS.TRIALING,
            trialEndsAt,
            therapistLimit,
            requestLimit,
        },
    });
};

/**
 * Get the active subscription for a customer.
 * Lazy creation: if no subscription exists (existing user), auto-creates a Free plan.
 * @param {string} customerId
 */
export const getActiveSubscription = async (customerId) => {
    const subscription = await prisma.subscription.findFirst({
        where: {
            customerId,
            status: { in: [SUBSCRIPTION_STATUS.ACTIVE, SUBSCRIPTION_STATUS.TRIALING, SUBSCRIPTION_STATUS.GRACE_PERIOD] },
        },
        orderBy: { createdAt: "desc" },
    });

    if (subscription) return subscription;

    const { requestLimit, therapistLimit } = PLAN_CONFIG.free;
    return prisma.subscription.create({
        data: {
            customerId,
            planType: "free",
            status: SUBSCRIPTION_STATUS.ACTIVE,
            therapistLimit,
            requestLimit,
        },
    });
};

/**
 * Get subscription with current usage counts for the frontend.
 * When a downgrade schedule is pending, resolves the target plan from Stripe
 * and includes it as `scheduledDowngradePlan` on the subscription object.
 * @param {string} customerId
 */
export const getSubscriptionWithUsage = async (customerId) => {
    const subscription = await getActiveSubscription(customerId);

    const [activeRequestCount, activeTherapistBookings] = await Promise.all([
        prisma.therapyRequest.count({
            where: { customerId, status: { in: ["created", "offers_received"] } },
        }),
        prisma.booking.groupBy({
            by: ["therapistId"],
            where: {
                customerId,
                status: { in: [BOOKING_STATUS.ACCEPTED, BOOKING_STATUS.CONFIRMED, BOOKING_STATUS.IN_PROGRESS] },
            },
        }),
    ]);

    let scheduledDowngradePlan = null;
    if (subscription.stripeScheduleId) {
        try {
            const schedule = await stripe.subscriptionSchedules.retrieve(subscription.stripeScheduleId);
            const phase2PriceId = schedule.phases?.[1]?.items?.[0]?.price;
            if (phase2PriceId) {
                const detected = getPlanFromPriceId(typeof phase2PriceId === "string" ? phase2PriceId : phase2PriceId.id);
                scheduledDowngradePlan = detected?.planType ?? null;
            }
        } catch {
            // Non-fatal — UI degrades gracefully without the plan name
        }
    }

    return {
        subscription: { ...subscription, scheduledDowngradePlan },
        usage: {
            activeRequests: activeRequestCount,
            activeTherapists: activeTherapistBookings.length,
        },
    };
};

/**
 * Create a Stripe Checkout Session for upgrading to a paid plan.
 * @param {string} customerId
 * @param {string} userId
 * @param {string} planType
 * @param {string} billingInterval
 */
export const createCheckoutSession = async (customerId, userId, planType, billingInterval) => {
    const { stripeCustomerId } = await getOrCreateStripeCustomer(userId);
    const priceId = getStripePriceId(planType, billingInterval);

    const existingMethods = await stripe.paymentMethods.list({
        customer: stripeCustomerId,
        type: "card",
        limit: 1,
    });

    const session = await stripe.checkout.sessions.create({
        customer: stripeCustomerId,
        mode: "subscription",
        line_items: [{ price: priceId, quantity: 1 }],
        metadata: { customerId, planType, billingInterval },
        ...(existingMethods.data.length > 0 && { payment_method_collection: "if_required" }),
        success_url: `${process.env.FRONTEND_URL}/customer/subscription/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.FRONTEND_URL}/customer/subscription`,
    });

    return { url: session.url };
};

/**
 * Create a Stripe Billing Portal session for managing subscription.
 * @param {string} userId
 */
export const createBillingPortalSession = async (userId) => {
    const { stripeCustomerId } = await getOrCreateStripeCustomer(userId);

    const session = await stripe.billingPortal.sessions.create({
        customer: stripeCustomerId,
        return_url: `${process.env.FRONTEND_URL}/customer/subscription`,
    });

    return { url: session.url };
};

/**
 * Customer-initiated cancellation. Sets cancel_at_period_end so the subscription
 * stays active until the current billing period ends.
 * Releases any pending downgrade schedule first to avoid Stripe conflicts.
 * @param {string} customerId
 */
export const cancelSubscription = async (customerId) => {
    const subscription = await prisma.subscription.findFirst({
        where: { customerId, status: { in: ["active"] }, stripeSubscriptionId: { not: null } },
    });

    if (!subscription) throw new NotFoundError("No active paid subscription found");

    await releaseScheduleIfPending(subscription);

    await stripe.subscriptions.update(subscription.stripeSubscriptionId, {
        cancel_at_period_end: true,
    });

    const updated = await prisma.subscription.update({
        where: { id: subscription.id },
        data: { cancelledAt: new Date() },
        include: { customer: { include: { user: true } } },
    });

    sendSubscriptionCancelledByCustomer({ customer: updated.customer, subscription: updated }).catch((err) => {
        logger.error("[Subscription] Failed to send cancellation email", { error: err.message });
    });

    return { message: "Subscription will be cancelled at the end of the current billing period" };
};

/**
 * Resume a customer-cancelled subscription before the period ends.
 * @param {string} customerId
 */
export const resumeSubscription = async (customerId) => {
    const subscription = await prisma.subscription.findFirst({
        where: {
            customerId,
            status: SUBSCRIPTION_STATUS.ACTIVE,
            stripeSubscriptionId: { not: null },
            cancelledAt: { not: null },
        },
    });

    if (!subscription) throw new NotFoundError("No cancelled subscription found to resume");

    await stripe.subscriptions.update(subscription.stripeSubscriptionId, {
        cancel_at_period_end: false,
    });

    await prisma.subscription.update({
        where: { id: subscription.id },
        data: { cancelledAt: null },
    });

    logSystemEvent({
        action: "subscription.resumed",
        entityType: "subscription",
        entityId: subscription.id,
        changes: { customerId },
    });

    return { message: "Subscription resumed successfully" };
};

/**
 * Preview the proration cost for upgrading to a higher plan.
 * Calls Stripe's invoice preview API — no charge, no side effects.
 * @param {string} customerId
 * @param {string} planType
 * @param {string} billingInterval
 */
export const previewUpgrade = async (customerId, planType, billingInterval) => {
    const subscription = await prisma.subscription.findFirst({
        where: { customerId, status: { in: ["active"] }, stripeSubscriptionId: { not: null } },
    });

    if (!subscription) throw new NotFoundError("No active paid subscription to preview upgrade for");

    const newPriceId = getStripePriceId(planType, billingInterval);
    const stripeSubscription = await stripe.subscriptions.retrieve(subscription.stripeSubscriptionId);
    const subscriptionItemId = stripeSubscription.items.data[0]?.id;
    if (!subscriptionItemId) throw new NotFoundError("Could not find subscription item in Stripe");

    const customerProfile = await prisma.customerProfile.findUnique({
        where: { id: customerId },
        select: { stripeCustomerId: true },
    });

    const preview = await stripe.invoices.createPreview({
        customer: customerProfile.stripeCustomerId,
        subscription: subscription.stripeSubscriptionId,
        subscription_details: {
            items: [{ id: subscriptionItemId, price: newPriceId }],
            proration_behavior: "always_invoice",
        },
    });

    const lines = preview.lines.data;
    const credits = lines.filter(l => l.amount < 0).reduce((sum, l) => sum + l.amount, 0);
    const charges = lines.filter(l => l.amount > 0).reduce((sum, l) => sum + l.amount, 0);

    return {
        credit: Math.abs(credits) / 100,
        charge: charges / 100,
        netAmount: preview.amount_due / 100,
        currency: preview.currency,
        currentPlan: subscription.planType,
        targetPlan: planType,
        billingInterval,
        periodEnd: parseStripeDate(stripeSubscription.items.data[0]?.current_period_end),
    };
};

/**
 * Upgrade a paid subscription to a higher plan.
 *
 * Uses `allow_incomplete` so Stripe updates the subscription even when the
 * proration invoice requires 3DS authentication. With `error_if_incomplete`
 * Stripe throws before returning a PaymentIntent, making it impossible to
 * surface the client_secret needed for the authentication challenge.
 *
 * Flow:
 *   - Payment succeeds immediately  → DB updated, email sent
 *   - Payment requires 3DS          → returns {status:"requires_action", clientSecret}
 *                                     frontend calls confirmCardPayment(), then
 *                                     invoice.paid webhook finalises the DB update
 *   - Payment declined              → 402 thrown
 * @param {string} customerId
 * @param {string} planType
 * @param {string} billingInterval
 */
export const upgradeSubscription = async (customerId, planType, billingInterval) => {
    const subscription = await prisma.subscription.findFirst({
        where: { customerId, status: { in: ["active"] }, stripeSubscriptionId: { not: null } },
    });

    if (!subscription) throw new NotFoundError("No active paid subscription to upgrade. Use checkout for first-time subscriptions.");

    const currentRank = PLAN_CONFIG[subscription.planType]?.rank ?? 0;
    const targetRank = PLAN_CONFIG[planType]?.rank ?? 0;
    if (targetRank <= currentRank) throw new Error("Can only upgrade to a higher plan. Use downgrade for lower plans.");

    await releaseScheduleIfPending(subscription);

    const newPriceId = getStripePriceId(planType, billingInterval);
    const stripeSubscription = await stripe.subscriptions.retrieve(subscription.stripeSubscriptionId);
    const subscriptionItemId = stripeSubscription.items.data[0]?.id;
    if (!subscriptionItemId) throw new NotFoundError("Could not find subscription item in Stripe");

    let updated;
    try {
        updated = await stripe.subscriptions.update(subscription.stripeSubscriptionId, {
            items: [{ id: subscriptionItemId, price: newPriceId }],
            proration_behavior: "always_invoice",
            payment_behavior: "allow_incomplete",
            metadata: { planType, billingInterval },
            expand: ["latest_invoice.payment_intent"],
        });
    } catch (stripeError) {
        if (stripeError.type === "StripeCardError" || stripeError.statusCode === 402) {
            logger.warn("[Subscription] Upgrade payment declined", { customerId, planType, error: stripeError.message });
            const error = new Error(stripeError.message || "Payment failed. Please update your payment method and try again.");
            error.statusCode = 402;
            error.code = "PAYMENT_FAILED";
            throw error;
        }
        throw stripeError;
    }

    const pi = updated.latest_invoice?.payment_intent;

    logger.info("[Subscription:DEBUG] upgradeSubscription — stripe update result", {
        updatedSubscriptionStatus: updated.status,
        latestInvoiceId: updated.latest_invoice?.id,
        paymentIntentId: pi?.id,
        paymentIntentStatus: pi?.status,
        paymentIntentClientSecretPresent: !!pi?.client_secret,
    });

    if (pi?.status === "requires_action") {
        logger.info("[Subscription] Upgrade requires 3DS authentication", { customerId, planType, paymentIntentId: pi.id });
        return {
            status: "requires_action",
            clientSecret: pi.client_secret,
            paymentIntentId: pi.id,
            paymentMethodId: typeof pi.payment_method === "string" ? pi.payment_method : pi.payment_method?.id,
        };
    }

    if (pi?.status === "requires_payment_method") {
        logger.warn("[Subscription:DEBUG] upgradeSubscription — card declined", { customerId, planType, paymentIntentId: pi?.id });
        const error = new Error("Your card was declined. Please update your payment method and try again.");
        error.statusCode = 402;
        error.code = "PAYMENT_FAILED";
        throw error;
    }

    const subscriptionItem = updated.items?.data?.[0];
    const { requestLimit, therapistLimit } = PLAN_CONFIG[planType] || PLAN_CONFIG.free;

    const updatedSub = await prisma.subscription.update({
        where: { id: subscription.id },
        data: {
            planType,
            billingInterval: billingInterval || subscription.billingInterval,
            stripePriceId: newPriceId,
            currentPeriodStart: parseStripeDate(subscriptionItem?.current_period_start),
            currentPeriodEnd: parseStripeDate(subscriptionItem?.current_period_end),
            therapistLimit: therapistLimit ?? 999999,
            requestLimit: requestLimit ?? 999999,
            cancelledAt: null,
            cancelReason: null,
        },
        include: { customer: { include: { user: true } } },
    });

    sendSubscriptionUpgraded({ customer: updatedSub.customer, subscription: updatedSub }).catch((err) => {
        logger.error("[Subscription] Failed to send upgrade email", { error: err.message });
    });

    logSystemEvent({
        action: "subscription.upgraded",
        entityType: "subscription",
        entityId: subscription.id,
        changes: { from: subscription.planType, to: planType, billingInterval },
    });

    logger.info("[Subscription] Plan upgraded", { customerId, from: subscription.planType, to: planType });

    return { status: "succeeded", message: `Upgraded to ${planType}. Prorated charge applied.` };
};

/**
 * Schedule a downgrade to a lower paid plan via Stripe Subscription Schedules.
 * Stripe owns the phase transition — no magic strings, no race conditions.
 * Takes effect at the end of the current billing period.
 * @param {string} customerId
 * @param {string} planType
 * @param {string} billingInterval
 */
export const downgradeSubscription = async (customerId, planType, billingInterval) => {
    const subscription = await prisma.subscription.findFirst({
        where: { customerId, status: { in: ["active"] }, stripeSubscriptionId: { not: null } },
    });

    if (!subscription) throw new NotFoundError("No active paid subscription to downgrade");

    const currentRank = PLAN_CONFIG[subscription.planType]?.rank ?? 0;
    const targetRank = PLAN_CONFIG[planType]?.rank ?? 0;
    if (targetRank >= currentRank) throw new Error("Can only downgrade to a lower plan. Use upgrade for higher plans.");
    if (planType === "free") throw new Error("To move to Free, cancel your subscription instead.");

    await releaseScheduleIfPending(subscription);

    const newPriceId = getStripePriceId(planType, billingInterval);
    const currentPeriodEnd = Math.floor(new Date(subscription.currentPeriodEnd).getTime() / 1000);

    // Stripe does not allow phases + from_subscription in the same create call.
    // Create first (auto-populates Phase 1), then update to append the downgrade phase.
    // Phase 1 start_date must be echoed back — it is locked to when the subscription
    // started and cannot be modified, only re-stated.
    const schedule = await stripe.subscriptionSchedules.create({
        from_subscription: subscription.stripeSubscriptionId,
    });

    const phase1StartDate = schedule.phases[0].start_date;

    await stripe.subscriptionSchedules.update(schedule.id, {
        end_behavior: "release",
        phases: [
            {
                items: [{ price: subscription.stripePriceId }],
                start_date: phase1StartDate,
                end_date: currentPeriodEnd,
            },
            {
                items: [{ price: newPriceId }],
            },
        ],
    });

    await prisma.subscription.update({
        where: { id: subscription.id },
        data: { stripeScheduleId: schedule.id, cancelReason: null },
    });

    logSystemEvent({
        action: "subscription.downgrade_scheduled",
        entityType: "subscription",
        entityId: subscription.id,
        changes: { from: subscription.planType, to: planType, effectiveAt: subscription.currentPeriodEnd },
    });

    logger.info("[Subscription] Downgrade scheduled via Subscription Schedule", {
        customerId, from: subscription.planType, to: planType, scheduleId: schedule.id,
    });

    return {
        message: `Your plan will downgrade to ${planType} at the end of your current billing period.`,
        effectiveAt: subscription.currentPeriodEnd,
    };
};

/**
 * Cancel a pending scheduled downgrade by releasing the Stripe Subscription Schedule.
 * @param {string} customerId
 */
export const cancelScheduledDowngrade = async (customerId) => {
    const subscription = await prisma.subscription.findFirst({
        where: { customerId, status: { in: ["active"] }, stripeScheduleId: { not: null } },
    });

    if (!subscription) throw new NotFoundError("No scheduled downgrade found to cancel.");

    await releaseScheduleIfPending(subscription);

    logSystemEvent({
        action: "subscription.downgrade_cancelled",
        entityType: "subscription",
        entityId: subscription.id,
        changes: { customerId },
    });

    logger.info("[Subscription] Scheduled downgrade cancelled", { subscriptionId: subscription.id, customerId });

    return { message: "Scheduled downgrade has been cancelled. Your current plan will continue." };
};
