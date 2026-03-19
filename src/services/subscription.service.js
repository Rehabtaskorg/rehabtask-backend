import { prisma } from "../config/prisma.js";
import { stripe } from "../config/stripe.js";
import { getOrCreateStripeCustomer } from "./payment.service.js";
import {
    sendSubscriptionActivated,
    sendSubscriptionPaymentFailed,
    sendTrialExpired,
    sendSubscriptionDowngraded,
} from "./email.service.js";
import { logger } from "../config/logger.js";
import { PLAN_CONFIG, TRIAL_DURATION_DAYS, GRACE_PERIOD_DAYS, getStripePriceId } from "../config/subscriptionPlans.js";
import { logSystemEvent } from "./audit.service.js";

/**
 * Safely parse a Stripe timestamp to a Date.
 * Handles both Unix timestamps (seconds) and ISO 8601 strings.
 */
const parseStripeDate = (value) => {
    if (!value) return null;
    if (typeof value === "number") return new Date(value * 1000);
    if (typeof value === "string") return new Date(value);
    if (value instanceof Date) return value;
    return null;
};

/**
 * Create a trial subscription for a new customer.
 * Called during registration inside the withAdminAccess transaction.
 */
export const createTrialSubscription = async (customerId, tx = prisma) => {
    const trialEndsAt = new Date(Date.now() + TRIAL_DURATION_DAYS * 24 * 60 * 60 * 1000);
    const { requestLimit, therapistLimit } = PLAN_CONFIG.standard;

    return tx.subscription.create({
        data: {
            customerId,
            planType: "standard",
            status: "trialing",
            trialEndsAt,
            therapistLimit,
            requestLimit,
        },
    });
};

/**
 * Get the active subscription for a customer.
 * Lazy creation: if no subscription exists (existing user), auto-creates a Free plan.
 */
export const getActiveSubscription = async (customerId) => {
    const subscription = await prisma.subscription.findFirst({
        where: {
            customerId,
            status: { in: ["active", "trialing", "grace_period"] },
        },
        orderBy: { createdAt: "desc" },
    });

    if (subscription) return subscription;

    // Lazy creation for existing users with no subscription
    const { requestLimit, therapistLimit } = PLAN_CONFIG.free;
    return prisma.subscription.create({
        data: {
            customerId,
            planType: "free",
            status: "active",
            therapistLimit,
            requestLimit,
        },
    });
};

/**
 * Get subscription with current usage counts for the frontend.
 */
export const getSubscriptionWithUsage = async (customerId) => {
    const subscription = await getActiveSubscription(customerId);

    const [activeRequestCount, activeTherapistBookings] = await Promise.all([
        prisma.therapyRequest.count({
            where: {
                customerId,
                status: { in: ["created", "offers_received"] },
            },
        }),
        prisma.booking.groupBy({
            by: ["therapistId"],
            where: {
                customerId,
                status: { in: ["accepted", "confirmed", "in_progress"] },
            },
        }),
    ]);

    return {
        subscription,
        usage: {
            activeRequests: activeRequestCount,
            activeTherapists: activeTherapistBookings.length,
        },
    };
};

/**
 * Create a Stripe Checkout Session for upgrading to a paid plan.
 */
export const createCheckoutSession = async (customerId, userId, planType, billingInterval) => {
    const { stripeCustomerId } = await getOrCreateStripeCustomer(userId);
    const priceId = getStripePriceId(planType, billingInterval);

    // Check if customer already has saved payment methods — if so, let Stripe
    // pre-fill instead of creating a duplicate
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
        ...(existingMethods.data.length > 0 && {
            payment_method_collection: "if_required",
        }),
        success_url: `${process.env.FRONTEND_URL}/customer/subscription/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.FRONTEND_URL}/customer/subscription`,
    });

    return { url: session.url };
};

/**
 * Create a Stripe Billing Portal session for managing subscription.
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
 * Customer-initiated cancellation. Sets cancel_at_period_end so subscription
 * stays active until the current billing period ends.
 */
export const cancelSubscription = async (customerId) => {
    const subscription = await prisma.subscription.findFirst({
        where: {
            customerId,
            status: { in: ["active"] },
            stripeSubscriptionId: { not: null },
        },
    });

    if (!subscription) {
        throw new Error("No active paid subscription found");
    }

    await stripe.subscriptions.update(subscription.stripeSubscriptionId, {
        cancel_at_period_end: true,
    });

    await prisma.subscription.update({
        where: { id: subscription.id },
        data: { cancelledAt: new Date() },
    });

    return { message: "Subscription will be cancelled at the end of the current billing period" };
};

// ─── Webhook Handlers ────────────────────────────────────────────────────────

/**
 * Handle checkout.session.completed webhook.
 * Finds existing trial/free subscription and upgrades it, or creates new.
 */
export const handleCheckoutCompleted = async (session) => {
    if (session.mode !== "subscription") return;

    const { customerId, planType, billingInterval } = session.metadata;
    if (!customerId || !planType) {
        logger.warn("[Subscription] checkout.session.completed missing metadata", { sessionId: session.id });
        return;
    }

    const stripeSubscriptionId = session.subscription;

    // Idempotency: if already processed, skip
    const alreadyProcessed = await prisma.subscription.findFirst({
        where: { stripeSubscriptionId },
    });
    if (alreadyProcessed) {
        logger.info("[Subscription] checkout.session.completed already processed", { stripeSubscriptionId });
        return;
    }

    const stripeSubscription = await stripe.subscriptions.retrieve(stripeSubscriptionId);

    // In Stripe API 2025+, period dates are on subscription items, not the subscription object
    const subscriptionItem = stripeSubscription.items?.data?.[0];

    const { requestLimit, therapistLimit } = PLAN_CONFIG[planType] || PLAN_CONFIG.free;

    // Find existing subscription for this customer (trial or free) and upgrade
    const existing = await prisma.subscription.findFirst({
        where: { customerId },
        orderBy: { createdAt: "desc" },
    });

    const data = {
        stripeSubscriptionId,
        stripeCustomerId: session.customer,
        stripePriceId: subscriptionItem?.price?.id || null,
        planType,
        billingInterval: billingInterval || null,
        status: "active",
        currentPeriodStart: parseStripeDate(subscriptionItem?.current_period_start),
        currentPeriodEnd: parseStripeDate(subscriptionItem?.current_period_end),
        trialEndsAt: null,
        gracePeriodEndsAt: null,
        cancelledAt: null,
        cancelReason: null,
        therapistLimit: therapistLimit ?? 999999,
        requestLimit: requestLimit ?? 999999,
    };

    let subscription;
    if (existing) {
        subscription = await prisma.subscription.update({
            where: { id: existing.id },
            data,
        });
    } else {
        subscription = await prisma.subscription.create({
            data: { ...data, customerId },
        });
    }

    // Send activation email
    try {
        const customer = await prisma.customerProfile.findUnique({
            where: { id: customerId },
            include: { user: true },
        });
        if (customer) {
            await sendSubscriptionActivated({ customer, subscription });
        }
    } catch (err) {
        logger.error("[Subscription] Failed to send activation email", { error: err.message });
    }

    // Event: subscription.created
    logSystemEvent({
        action: "subscription.created",
        entityType: "subscription",
        entityId: subscription.id,
        changes: { customerId, planType, billingInterval, stripeSubscriptionId },
    });

    logger.info("[Subscription] Checkout completed", { customerId, planType, stripeSubscriptionId });
};

/**
 * Handle invoice.paid webhook. Renews the subscription period.
 */
export const handleInvoicePaid = async (invoice) => {
    const stripeSubscriptionId = invoice.subscription;
    if (!stripeSubscriptionId) return;

    const subscription = await prisma.subscription.findFirst({
        where: { stripeSubscriptionId },
    });

    if (!subscription) {
        logger.warn("[Subscription] invoice.paid — no matching subscription", { stripeSubscriptionId });
        return;
    }

    // Already active — idempotent
    const periodEnd = parseStripeDate(invoice.lines?.data[0]?.period?.end);
    if (subscription.status === "active" &&
        subscription.currentPeriodEnd && periodEnd &&
        periodEnd <= subscription.currentPeriodEnd) {
        return;
    }

    await prisma.subscription.update({
        where: { id: subscription.id },
        data: {
            status: "active",
            currentPeriodStart: parseStripeDate(invoice.lines?.data[0]?.period?.start),
            currentPeriodEnd: periodEnd,
            gracePeriodEndsAt: null,
        },
    });

    // Event: subscription.renewed
    logSystemEvent({
        action: "subscription.renewed",
        entityType: "subscription",
        entityId: subscription.id,
        changes: { stripeSubscriptionId, periodEnd: parseStripeDate(invoice.lines?.data[0]?.period?.end) },
    });

    logger.info("[Subscription] Invoice paid — period renewed", { subscriptionId: subscription.id });
};

/**
 * Handle invoice.payment_failed webhook.
 */
export const handleInvoicePaymentFailed = async (invoice) => {
    const stripeSubscriptionId = invoice.subscription;
    if (!stripeSubscriptionId) return;

    const subscription = await prisma.subscription.findFirst({
        where: { stripeSubscriptionId },
    });

    if (!subscription) return;

    await prisma.subscription.update({
        where: { id: subscription.id },
        data: { status: "past_due" },
    });

    // Send payment failed email
    try {
        const customer = await prisma.customerProfile.findUnique({
            where: { id: subscription.customerId },
            include: { user: true },
        });
        if (customer) await sendSubscriptionPaymentFailed({ customer });
    } catch (err) {
        logger.error("[Subscription] Failed to send payment failed email", { error: err.message });
    }

    // Event: subscription.payment_failed
    logSystemEvent({
        action: "subscription.payment_failed",
        entityType: "subscription",
        entityId: subscription.id,
        changes: { stripeSubscriptionId, invoiceId: invoice.id },
    });

    logger.warn("[Subscription] Invoice payment failed", { subscriptionId: subscription.id });
};

/**
 * Handle customer.subscription.deleted webhook.
 * Stripe fires this after exhausting retries or on immediate cancel.
 * Start grace period before downgrading to free.
 */
export const handleSubscriptionDeleted = async (stripeSubscription) => {
    const subscription = await prisma.subscription.findFirst({
        where: { stripeSubscriptionId: stripeSubscription.id },
    });

    if (!subscription) return;

    const gracePeriodEndsAt = new Date(Date.now() + GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000);

    await prisma.subscription.update({
        where: { id: subscription.id },
        data: {
            status: "grace_period",
            gracePeriodEndsAt,
            cancelledAt: subscription.cancelledAt || new Date(),
        },
    });

    // Event: subscription.canceled (entering grace period)
    logSystemEvent({
        action: "subscription.canceled",
        entityType: "subscription",
        entityId: subscription.id,
        changes: { previousPlan: subscription.planType, gracePeriodEndsAt },
    });

    logger.info("[Subscription] Deleted — entering grace period", {
        subscriptionId: subscription.id,
        gracePeriodEndsAt,
    });
};

/**
 * Handle customer.subscription.updated webhook.
 * Syncs status and period dates from Stripe.
 */
export const handleSubscriptionUpdated = async (stripeSubscription) => {
    const subscription = await prisma.subscription.findFirst({
        where: { stripeSubscriptionId: stripeSubscription.id },
    });

    if (!subscription) return;

    const statusMap = {
        active: "active",
        past_due: "past_due",
        canceled: "cancelled",
        unpaid: "past_due",
        incomplete: "inactive",
        incomplete_expired: "inactive",
        trialing: "trialing",
    };

    const mappedStatus = statusMap[stripeSubscription.status] || subscription.status;
    const subItem = stripeSubscription.items?.data?.[0];

    // If customer resumed their subscription (cancel_at_period_end flipped to false),
    // clear the cancelledAt so the UI reflects the active state
    const resumed = stripeSubscription.cancel_at_period_end === false && subscription.cancelledAt;

    await prisma.subscription.update({
        where: { id: subscription.id },
        data: {
            status: mappedStatus,
            currentPeriodStart: parseStripeDate(subItem?.current_period_start),
            currentPeriodEnd: parseStripeDate(subItem?.current_period_end),
            stripePriceId: subItem?.price?.id || subscription.stripePriceId,
            ...(resumed && { cancelledAt: null, cancelReason: null }),
        },
    });

    if (resumed) {
        logger.info("[Subscription] Customer resumed subscription", { subscriptionId: subscription.id });
    }

    logger.info("[Subscription] Updated from Stripe", {
        subscriptionId: subscription.id,
        stripeStatus: stripeSubscription.status,
        mappedStatus,
    });
};

// ─── Cron Functions ──────────────────────────────────────────────────────────

/**
 * Downgrade expired trials to free plan.
 */
export const runTrialExpiry = async () => {
    const expired = await prisma.subscription.findMany({
        where: {
            status: "trialing",
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
                status: "active",
                planType: "free",
                trialEndsAt: null,
                therapistLimit,
                requestLimit,
            },
        });

        // Event: subscription.trial_expired
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
            subscriptionId: sub.id,
            customerId: sub.customerId,
        });
    }

    logger.info(`[Subscription] Trial expiry check: ${expired.length} downgraded`);
};

/**
 * Downgrade expired grace periods to free plan.
 */
export const runGracePeriodExpiry = async () => {
    const expired = await prisma.subscription.findMany({
        where: {
            status: "grace_period",
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
                status: "active",
                planType: "free",
                gracePeriodEndsAt: null,
                stripeSubscriptionId: null,
                stripePriceId: null,
                billingInterval: null,
                therapistLimit,
                requestLimit,
            },
        });

        // Event: subscription.grace_period_expired
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
            subscriptionId: sub.id,
            customerId: sub.customerId,
        });
    }

    logger.info(`[Subscription] Grace period expiry check: ${expired.length} downgraded`);
};