import { SUBSCRIPTION_STATUS, BOOKING_STATUS, TIME_MS } from "../utils/constants.js";
import { prisma } from "../config/prisma.js";
import { stripe } from "../config/stripe.js";
import { getOrCreateStripeCustomer } from "./payment.service.js";
import {
    sendSubscriptionActivated,
    sendSubscriptionPaymentFailed,
    sendSubscriptionCancelledByCustomer,
    sendSubscriptionUpgraded,
    sendTrialExpired,
    sendSubscriptionDowngraded,
} from "./email.service.js";
import { logger } from "../config/logger.js";
import { PLAN_CONFIG, TRIAL_DURATION_DAYS, GRACE_PERIOD_DAYS, getStripePriceId, getPlanFromPriceId } from "../config/subscriptionPlans.js";
import { logSystemEvent } from "./audit.service.js";
import { trackServerEvent } from "../config/posthog.js";

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
    const trialEndsAt = new Date(Date.now() + TRIAL_DURATION_DAYS * TIME_MS.TWENTY_FOUR_HOURS);
    const { requestLimit, therapistLimit } = PLAN_CONFIG.standard;

    const sub = await tx.subscription.create({
        data: {
            customerId,
            planType: "standard",
            status: SUBSCRIPTION_STATUS.TRIALING,
            trialEndsAt,
            therapistLimit,
            requestLimit,
        },
    });
    logger.info("[Subscription:DEBUG] Trial created", { customerId, subscriptionId: sub.id, trialEndsAt });
    return sub;
};

/**
 * Get the active subscription for a customer.
 * Lazy creation: if no subscription exists (existing user), auto-creates a Free plan.
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

    // Lazy creation for existing users with no subscription
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
                status: { in: [BOOKING_STATUS.ACCEPTED, BOOKING_STATUS.CONFIRMED, BOOKING_STATUS.IN_PROGRESS] },
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

    logger.info("[Subscription:DEBUG] createCheckoutSession", { customerId, userId, planType, billingInterval, stripeCustomerId, priceId });

    const existingMethods = await stripe.paymentMethods.list({
        customer: stripeCustomerId,
        type: "card",
        limit: 1,
    });

    logger.info("[Subscription:DEBUG] Existing payment methods count", { count: existingMethods.data.length });

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

    logger.info("[Subscription:DEBUG] Checkout session created", { sessionId: session.id, url: session.url });
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
 * Release a pending Subscription Schedule and clear it from the DB.
 * Call before any operation that would conflict with an active schedule
 * (upgrade, cancel, or replace-downgrade).
 * @param {object} subscription - DB subscription record
 */
const releaseScheduleIfPending = async (subscription) => {
    if (!subscription.stripeScheduleId) return;
    await stripe.subscriptionSchedules.release(subscription.stripeScheduleId);
    await prisma.subscription.update({
        where: { id: subscription.id },
        data: { stripeScheduleId: null },
    });
    logger.info("[Subscription] Released existing schedule", { subscriptionId: subscription.id, scheduleId: subscription.stripeScheduleId });
};

/**
 * Customer-initiated cancellation. Sets cancel_at_period_end so the subscription
 * stays active until the current billing period ends.
 * Releases any pending downgrade schedule first to avoid Stripe conflicts.
 */
export const cancelSubscription = async (customerId) => {
    const subscription = await prisma.subscription.findFirst({
        where: { customerId, status: { in: ["active"] }, stripeSubscriptionId: { not: null } },
    });

    if (!subscription) throw new Error("No active paid subscription found");

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

export const resumeSubscription = async (customerId) => {
    const subscription = await prisma.subscription.findFirst({
        where: {
            customerId,
            status: SUBSCRIPTION_STATUS.ACTIVE,
            stripeSubscriptionId: { not: null },
            cancelledAt: { not: null },
        },
    });

    if (!subscription) {
        throw new Error("No cancelled subscription found to resume");
    }

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
 */
export const previewUpgrade = async (customerId, planType, billingInterval) => {
    const subscription = await prisma.subscription.findFirst({
        where: { customerId, status: { in: ["active"] }, stripeSubscriptionId: { not: null } },
    });

    if (!subscription) {
        throw new Error("No active paid subscription to preview upgrade for.");
    }

    const newPriceId = getStripePriceId(planType, billingInterval);

    const stripeSubscription = await stripe.subscriptions.retrieve(subscription.stripeSubscriptionId);
    const subscriptionItemId = stripeSubscription.items.data[0]?.id;
    if (!subscriptionItemId) {
        throw new Error("Could not find subscription item in Stripe");
    }

    // Get the customer's Stripe customer ID
    const customerProfile = await prisma.customerProfile.findUnique({
        where: { id: customerId },
        select: { stripeCustomerId: true },
    });

    // Preview the upcoming invoice with the price change
    const preview = await stripe.invoices.createPreview({
        customer: customerProfile.stripeCustomerId,
        subscription: subscription.stripeSubscriptionId,
        subscription_details: {
            items: [{ id: subscriptionItemId, price: newPriceId }],
            proration_behavior: "always_invoice",
        },
    });

    // Extract proration line items
    const lines = preview.lines.data;
    const credits = lines.filter(l => l.amount < 0).reduce((sum, l) => sum + l.amount, 0);
    const charges = lines.filter(l => l.amount > 0).reduce((sum, l) => sum + l.amount, 0);
    const netAmount = preview.amount_due; // What the customer actually pays today

    return {
        credit: Math.abs(credits) / 100,       // Unused current plan credit (positive number)
        charge: charges / 100,                   // New plan prorated charge
        netAmount: netAmount / 100,              // Net charge today
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
 *   - Payment succeeds immediately  → subscription active, DB updated, email sent
 *   - Payment requires 3DS          → returns {status:"requires_action", clientSecret}
 *                                     frontend calls confirmCardPayment(), then
 *                                     invoice.paid webhook finalises the DB update
 *   - Payment declined              → subscription reverts via Stripe, 402 thrown
 */
export const upgradeSubscription = async (customerId, planType, billingInterval) => {
    const subscription = await prisma.subscription.findFirst({
        where: { customerId, status: { in: ["active"] }, stripeSubscriptionId: { not: null } },
    });

    logger.info("[Subscription:DEBUG] upgradeSubscription called", {
        customerId, planType, billingInterval,
        existingSubscription: subscription ? { id: subscription.id, planType: subscription.planType, status: subscription.status } : null,
    });

    if (!subscription) {
        throw new Error("No active paid subscription to upgrade. Use checkout for first-time subscriptions.");
    }

    const currentRank = PLAN_CONFIG[subscription.planType]?.rank ?? 0;
    const targetRank = PLAN_CONFIG[planType]?.rank ?? 0;
    if (targetRank <= currentRank) {
        throw new Error("Can only upgrade to a higher plan. Use downgrade for lower plans.");
    }

    await releaseScheduleIfPending(subscription);

    const newPriceId = getStripePriceId(planType, billingInterval);

    const stripeSubscription = await stripe.subscriptions.retrieve(subscription.stripeSubscriptionId);
    const subscriptionItemId = stripeSubscription.items.data[0]?.id;
    if (!subscriptionItemId) throw new Error("Could not find subscription item in Stripe");

    logger.info("[Subscription:DEBUG] upgradeSubscription — calling stripe.subscriptions.update", {
        stripeSubscriptionId: subscription.stripeSubscriptionId,
        subscriptionItemId,
        newPriceId,
        payment_behavior: "allow_incomplete",
    });

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
        logger.error("[Subscription:DEBUG] upgradeSubscription — stripe.subscriptions.update threw", {
            code: stripeError.code,
            type: stripeError.type,
            statusCode: stripeError.statusCode,
            message: stripeError.message,
        });
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

    // Payment succeeded immediately — update DB now
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
 */
export const downgradeSubscription = async (customerId, planType, billingInterval) => {
    const subscription = await prisma.subscription.findFirst({
        where: { customerId, status: { in: ["active"] }, stripeSubscriptionId: { not: null } },
    });

    if (!subscription) throw new Error("No active paid subscription to downgrade");

    const currentRank = PLAN_CONFIG[subscription.planType]?.rank ?? 0;
    const targetRank = PLAN_CONFIG[planType]?.rank ?? 0;
    if (targetRank >= currentRank) throw new Error("Can only downgrade to a lower plan. Use upgrade for higher plans.");
    if (planType === "free") throw new Error("To move to Free, cancel your subscription instead.");

    // Release any existing schedule (change-of-mind scenario)
    await releaseScheduleIfPending(subscription);

    const newPriceId = getStripePriceId(planType, billingInterval);
    const currentPeriodEnd = Math.floor(new Date(subscription.currentPeriodEnd).getTime() / 1000);

    const schedule = await stripe.subscriptionSchedules.create({
        from_subscription: subscription.stripeSubscriptionId,
        phases: [
            {
                items: [{ price: subscription.stripePriceId }],
                end_date: currentPeriodEnd,
            },
            {
                items: [{ price: newPriceId }],
                iterations: 1,
            },
        ],
        end_behavior: "release",
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

//─── Webhook Handlers ────────────────────────────────────────────────────────

/**
 * Handle checkout.session.completed webhook.
 * Finds existing trial/free subscription and upgrades it, or creates new.
 */
export const handleCheckoutCompleted = async (session) => {
    logger.info("[Subscription:DEBUG] handleCheckoutCompleted fired", {
        sessionId: session.id,
        mode: session.mode,
        metadata: session.metadata,
        subscription: session.subscription,
        customer: session.customer,
        paymentStatus: session.payment_status,
    });

    if (session.mode !== "subscription") return;

    const { customerId, planType, billingInterval } = session.metadata;
    if (!customerId || !planType) {
        logger.warn("[Subscription] checkout.session.completed missing metadata", { sessionId: session.id, metadata: session.metadata });
        return;
    }

    const stripeSubscriptionId = session.subscription;

    const alreadyProcessed = await prisma.subscription.findFirst({
        where: { stripeSubscriptionId },
    });
    if (alreadyProcessed) {
        logger.info("[Subscription] checkout.session.completed already processed", { stripeSubscriptionId, existingId: alreadyProcessed.id });
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

    logger.info("[Subscription:DEBUG] handleCheckoutCompleted — existing subscription lookup", {
        customerId,
        existingId: existing?.id ?? null,
        existingStatus: existing?.status ?? null,
        existingPlan: existing?.planType ?? null,
        subscriptionItem: {
            id: subscriptionItem?.id,
            priceId: subscriptionItem?.price?.id,
            periodStart: subscriptionItem?.current_period_start,
            periodEnd: subscriptionItem?.current_period_end,
        },
    });

    const data = {
        stripeSubscriptionId,
        stripeCustomerId: session.customer,
        stripePriceId: subscriptionItem?.price?.id || null,
        planType,
        billingInterval: billingInterval || null,
        status: SUBSCRIPTION_STATUS.ACTIVE,
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
        logger.info("[Subscription:DEBUG] handleCheckoutCompleted — updated existing subscription", { subscriptionId: subscription.id, planType, status: subscription.status });
    } else {
        subscription = await prisma.subscription.create({
            data: { ...data, customerId },
        });
        logger.info("[Subscription:DEBUG] handleCheckoutCompleted — created new subscription", { subscriptionId: subscription.id, planType });
    }

    // Send activation email and fire analytics
    try {
        const customer = await prisma.customerProfile.findUnique({
            where: { id: customerId },
            include: { user: true },
        });
        logger.info("[Subscription:DEBUG] handleCheckoutCompleted — customer lookup for email", { found: !!customer, email: customer?.user?.email ?? null });
        if (customer) {
            await sendSubscriptionActivated({ customer, subscription });
            logger.info("[Subscription:DEBUG] handleCheckoutCompleted — activation email sent", { email: customer.user.email });
            if (customer.user?.id) {
                trackServerEvent(customer.user.id, "subscription_activated", {
                    plan_type: planType,
                    billing_interval: billingInterval || null,
                });
            }
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
    logger.info("[Subscription:DEBUG] handleInvoicePaid fired", {
        invoiceId: invoice.id,
        stripeSubscriptionId: invoice.subscription,
        amountPaid: invoice.amount_paid,
        status: invoice.status,
        billingReason: invoice.billing_reason,
        customerId: invoice.customer,
    });

    const stripeSubscriptionId = invoice.subscription;
    if (!stripeSubscriptionId) return;

    const subscription = await prisma.subscription.findFirst({
        where: { stripeSubscriptionId },
    });

    if (!subscription) {
        logger.warn("[Subscription] invoice.paid — no matching subscription", { stripeSubscriptionId });
        return;
    }

    const periodEnd = parseStripeDate(invoice.lines?.data[0]?.period?.end);

    // Fetch Stripe subscription to detect 3DS-deferred plan changes.
    // The metadata (planType) is written by upgradeSubscription when 3DS is triggered.
    const stripeSub = await stripe.subscriptions.retrieve(stripeSubscriptionId);
    const stripePlanType = stripeSub.metadata?.planType;
    const hasPlanChange = stripePlanType && stripePlanType !== subscription.planType;

    // Skip if already up-to-date — idempotent guard
    if (!hasPlanChange &&
        subscription.status === "active" &&
        subscription.currentPeriodEnd && periodEnd &&
        periodEnd <= subscription.currentPeriodEnd) {
        logger.info("[Subscription] handleInvoicePaid — skipped (already up to date)", { subscriptionId: subscription.id });
        return;
    }

    const updateData = {
        status: SUBSCRIPTION_STATUS.ACTIVE,
        currentPeriodStart: parseStripeDate(invoice.lines?.data[0]?.period?.start),
        currentPeriodEnd: periodEnd,
        gracePeriodEndsAt: null,
    };

    // Apply plan change from a 3DS-deferred upgrade.
    if (hasPlanChange) {
        const planConfig = PLAN_CONFIG[stripePlanType];
        if (planConfig) {
            updateData.planType = stripePlanType;
            updateData.stripePriceId = stripeSub.items.data[0]?.price?.id;
            updateData.billingInterval = stripeSub.metadata?.billingInterval || subscription.billingInterval;
            updateData.therapistLimit = planConfig.therapistLimit ?? 999999;
            updateData.requestLimit = planConfig.requestLimit ?? 999999;
            updateData.cancelledAt = null;
            updateData.cancelReason = null;

            logger.info("[Subscription] 3DS-deferred upgrade applied via invoice.paid", {
                subscriptionId: subscription.id,
                from: subscription.planType,
                to: stripePlanType,
            });
        }
    }

    await prisma.subscription.update({
        where: { id: subscription.id },
        data: updateData,
    });

    logSystemEvent({
        action: hasPlanChange ? "subscription.upgraded" : "subscription.renewed",
        entityType: "subscription",
        entityId: subscription.id,
        changes: { stripeSubscriptionId, periodEnd, planType: updateData.planType ?? subscription.planType },
    });

    // Send upgrade email when plan changed via 3DS-deferred path
    if (hasPlanChange) {
        prisma.customerProfile.findUnique({
            where: { id: subscription.customerId },
            include: { user: true },
        }).then((customer) => {
            if (customer) sendSubscriptionUpgraded({ customer, subscription: { ...subscription, ...updateData } }).catch(() => { });
        }).catch(() => { });
    }

    // Fire-and-forget analytics
    prisma.customerProfile.findUnique({
        where: { id: subscription.customerId },
        select: { user: { select: { id: true } } },
    }).then((customer) => {
        if (customer?.user?.id) {
            trackServerEvent(customer.user.id, hasPlanChange ? "subscription_upgraded" : "subscription_renewed", {
                plan_type: updateData.planType ?? subscription.planType,
                billing_interval: updateData.billingInterval ?? subscription.billingInterval,
            });
        }
    }).catch(() => { });

    logger.info("[Subscription] Invoice paid", { subscriptionId: subscription.id, planChange: hasPlanChange });
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
        data: { status: SUBSCRIPTION_STATUS.PAST_DUE },
    });

    // Send payment failed email and fire analytics
    try {
        const customer = await prisma.customerProfile.findUnique({
            where: { id: subscription.customerId },
            include: { user: true },
        });
        if (customer) {
            await sendSubscriptionPaymentFailed({ customer });
            if (customer.user?.id) {
                trackServerEvent(customer.user.id, "subscription_payment_failed", {
                    plan_type: subscription.planType,
                });
            }
        }
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

    const gracePeriodEndsAt = new Date(Date.now() + GRACE_PERIOD_DAYS * TIME_MS.TWENTY_FOUR_HOURS);

    await prisma.subscription.update({
        where: { id: subscription.id },
        data: {
            status: SUBSCRIPTION_STATUS.GRACE_PERIOD,
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

    // Fire-and-forget analytics
    prisma.customerProfile.findUnique({
        where: { id: subscription.customerId },
        select: { user: { select: { id: true } } },
    }).then((customer) => {
        if (customer?.user?.id) {
            trackServerEvent(customer.user.id, "subscription_cancelled", {
                plan_type: subscription.planType,
            });
        }
    }).catch(() => { });

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
        past_due: SUBSCRIPTION_STATUS.PAST_DUE,
        canceled: "cancelled",
        unpaid: SUBSCRIPTION_STATUS.PAST_DUE,
        incomplete: "inactive",
        incomplete_expired: "inactive",
        trialing: SUBSCRIPTION_STATUS.TRIALING,
    };

    const mappedStatus = statusMap[stripeSubscription.status] || subscription.status;
    const subItem = stripeSubscription.items?.data?.[0];
    const currentPriceId = subItem?.price?.id;

    // Stripe has two cancellation mechanisms:
    // 1. cancel_at_period_end: true — used by our Cancel button
    // 2. cancel_at: <timestamp> — used by Stripe Billing Portal
    const isScheduledToCancel = stripeSubscription.cancel_at_period_end === true || !!stripeSubscription.cancel_at;
    const isNotScheduledToCancel = stripeSubscription.cancel_at_period_end === false && !stripeSubscription.cancel_at;

    const resumed = isNotScheduledToCancel && subscription.cancelledAt;
    const cancelledViaPortal = isScheduledToCancel && !subscription.cancelledAt;

    const planChanged = currentPriceId && currentPriceId !== subscription.stripePriceId;
    let planUpdate = {};
    if (planChanged) {
        const detected = getPlanFromPriceId(currentPriceId);
        if (detected && detected.planType !== subscription.planType) {
            const planConfig = PLAN_CONFIG[detected.planType];
            planUpdate = {
                planType: detected.planType,
                billingInterval: detected.billingInterval,
                therapistLimit: planConfig.therapistLimit ?? 999999,
                requestLimit: planConfig.requestLimit ?? 999999,
                cancelReason: null,
            };
            logger.info("[Subscription] Plan change detected from Stripe", {
                subscriptionId: subscription.id,
                from: subscription.planType,
                to: detected.planType,
            });
        }
    }

    await prisma.subscription.update({
        where: { id: subscription.id },
        data: {
            status: mappedStatus,
            currentPeriodStart: parseStripeDate(subItem?.current_period_start),
            currentPeriodEnd: parseStripeDate(subItem?.current_period_end),
            stripePriceId: currentPriceId || subscription.stripePriceId,
            ...(resumed && { cancelledAt: null, cancelReason: null }),
            ...(cancelledViaPortal && { cancelledAt: new Date() }),
            ...planUpdate,
        },
    });

    if (resumed) {
        logger.info("[Subscription] Customer resumed subscription", { subscriptionId: subscription.id });
    }

    if (cancelledViaPortal) {
        logger.info("[Subscription] Customer cancelled via Stripe portal", { subscriptionId: subscription.id });
    }

    logger.info("[Subscription] Updated from Stripe", {
        subscriptionId: subscription.id,
        stripeStatus: stripeSubscription.status,
        mappedStatus,
    });
};

/**
 * Handle subscription_schedule.released webhook.
 * Clears stripeScheduleId — fires when Stripe releases the schedule after the
 * final phase completes (end_behavior: "release").
 */
export const handleScheduleReleased = async (schedule) => {
    const subscription = await prisma.subscription.findFirst({
        where: { stripeScheduleId: schedule.id },
    });
    if (!subscription) return;

    await prisma.subscription.update({
        where: { id: subscription.id },
        data: { stripeScheduleId: null },
    });

    logger.info("[Subscription] Schedule released — stripeScheduleId cleared", {
        subscriptionId: subscription.id, scheduleId: schedule.id,
    });
};

/**
 * Handle subscription_schedule.canceled webhook.
 * Clears stripeScheduleId — fires when a schedule is explicitly canceled in Stripe.
 */
export const handleScheduleCanceled = async (schedule) => {
    const subscription = await prisma.subscription.findFirst({
        where: { stripeScheduleId: schedule.id },
    });
    if (!subscription) return;

    await prisma.subscription.update({
        where: { id: subscription.id },
        data: { stripeScheduleId: null },
    });

    logger.warn("[Subscription] Schedule canceled", {
        subscriptionId: subscription.id, scheduleId: schedule.id,
    });
};

// ─── Cron Functions ──────────────────────────────────────────────────────────

/**
 * Downgrade expired trials to free plan.
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