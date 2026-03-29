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
import { PLAN_CONFIG, TRIAL_DURATION_DAYS, GRACE_PERIOD_DAYS, getStripePriceId, getPlanFromPriceId } from "../config/subscriptionPlans.js";
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

export const resumeSubscription = async (customerId) => {
    const subscription = await prisma.subscription.findFirst({
        where: {
            customerId,
            status: "active",
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
 * Uses error_if_incomplete to prevent subscription change if payment fails.
 * The subscription only changes if the proration invoice is paid successfully.
 */
export const upgradeSubscription = async (customerId, planType, billingInterval) => {
    const subscription = await prisma.subscription.findFirst({
        where: { customerId, status: { in: ["active"] }, stripeSubscriptionId: { not: null } },
    });

    if (!subscription) {
        throw new Error("No active paid subscription to upgrade. Use checkout for first-time subscriptions.");
    }

    const currentRank = PLAN_CONFIG[subscription.planType]?.rank ?? 0;
    const targetRank = PLAN_CONFIG[planType]?.rank ?? 0;
    if (targetRank <= currentRank) {
        throw new Error("Can only upgrade to a higher plan. Use downgrade for lower plans.");
    }

    const newPriceId = getStripePriceId(planType, billingInterval);

    // Get the current subscription item ID from Stripe
    const stripeSubscription = await stripe.subscriptions.retrieve(subscription.stripeSubscriptionId);
    const subscriptionItemId = stripeSubscription.items.data[0]?.id;
    if (!subscriptionItemId) {
        throw new Error("Could not find subscription item in Stripe");
    }

    // Update with error_if_incomplete — if payment fails, Stripe throws and reverts
    let updated;
    try {
        updated = await stripe.subscriptions.update(subscription.stripeSubscriptionId, {
            items: [{ id: subscriptionItemId, price: newPriceId }],
            proration_behavior: "always_invoice",
            payment_behavior: "error_if_incomplete",
            metadata: { planType, billingInterval },
        });
    } catch (stripeError) {
        // Payment failed — Stripe reverted the subscription change
        if (stripeError.code === "payment_intent_action_required" || stripeError.type === "StripeCardError" || stripeError.statusCode === 402) {
            logger.warn("[Subscription] Upgrade payment failed", { customerId, planType, error: stripeError.message });
            const error = new Error("Payment failed. Please update your payment method and try again.");
            error.statusCode = 402;
            error.code = "PAYMENT_FAILED";
            throw error;
        }
        throw stripeError;
    }

    const subscriptionItem = updated.items?.data?.[0];
    const { requestLimit, therapistLimit } = PLAN_CONFIG[planType] || PLAN_CONFIG.free;

    // Payment succeeded — update local DB
    await prisma.subscription.update({
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
    });

    logSystemEvent({
        action: "subscription.upgraded",
        entityType: "subscription",
        entityId: subscription.id,
        changes: { from: subscription.planType, to: planType, billingInterval },
    });

    logger.info("[Subscription] Plan upgraded", { customerId, from: subscription.planType, to: planType });

    return { message: `Upgraded to ${planType}. Prorated charge applied.` };
};

/**
 * Downgrade a paid subscription to a lower paid plan.
 * Takes effect at the end of the current billing period — no proration, no immediate charge.
 */
export const downgradeSubscription = async (customerId, planType, billingInterval) => {
    const subscription = await prisma.subscription.findFirst({
        where: { customerId, status: { in: ["active"] }, stripeSubscriptionId: { not: null } },
    });

    if (!subscription) {
        throw new Error("No active paid subscription to downgrade");
    }

    const currentRank = PLAN_CONFIG[subscription.planType]?.rank ?? 0;
    const targetRank = PLAN_CONFIG[planType]?.rank ?? 0;
    if (targetRank >= currentRank) {
        throw new Error("Can only downgrade to a lower plan. Use upgrade for higher plans.");
    }

    if (planType === "free") {
        throw new Error("To move to Free, cancel your subscription instead.");
    }

    const newPriceId = getStripePriceId(planType, billingInterval);

    const stripeSubscription = await stripe.subscriptions.retrieve(subscription.stripeSubscriptionId);
    const subscriptionItemId = stripeSubscription.items.data[0]?.id;
    if (!subscriptionItemId) {
        throw new Error("Could not find subscription item in Stripe");
    }

    // Don't change the price in Stripe yet — just store the intent
    // The price change will be applied when handleInvoicePaid fires at next renewal
    // This keeps Premium active in Stripe until the billing period ends
    await stripe.subscriptions.update(subscription.stripeSubscriptionId, {
        metadata: { scheduledDowngrade: "true", downgradeToplan: planType, downgradeToBillingInterval: billingInterval },
    });

    // Store the downgrade intent in DB — customer keeps current plan until period ends
    await prisma.subscription.update({
        where: { id: subscription.id },
        data: {
            cancelReason: `scheduled_downgrade:${planType}:${billingInterval}`,
        },
    });

    logSystemEvent({
        action: "subscription.downgrade_scheduled",
        entityType: "subscription",
        entityId: subscription.id,
        changes: { from: subscription.planType, to: planType, effectiveAt: subscription.currentPeriodEnd },
    });

    logger.info("[Subscription] Downgrade scheduled", { customerId, from: subscription.planType, to: planType });

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

    // Already active — idempotent (but always process if there's a pending downgrade)
    const periodEnd = parseStripeDate(invoice.lines?.data[0]?.period?.end);
    const hasPendingDowngrade = subscription.cancelReason?.startsWith("scheduled_downgrade:");
    if (!hasPendingDowngrade &&
        subscription.status === "active" &&
        subscription.currentPeriodEnd && periodEnd &&
        periodEnd <= subscription.currentPeriodEnd) {
        return;
    }

    // Check if there's a scheduled downgrade pending
    const updateData = {
        status: "active",
        currentPeriodStart: parseStripeDate(invoice.lines?.data[0]?.period?.start),
        currentPeriodEnd: periodEnd,
        gracePeriodEndsAt: null,
    };

    if (subscription.cancelReason?.startsWith("scheduled_downgrade:")) {
        const parts = subscription.cancelReason.split(":");
        const newPlanType = parts[1];
        const newBillingInterval = parts[2] || subscription.billingInterval || "monthly";
        const planConfig = PLAN_CONFIG[newPlanType];
        if (planConfig) {
            // Change the price in Stripe NOW (at renewal time)
            try {
                const newPriceId = getStripePriceId(newPlanType, newBillingInterval);
                const stripeSubObj = await stripe.subscriptions.retrieve(stripeSubscriptionId);
                const itemId = stripeSubObj.items.data[0]?.id;
                if (itemId) {
                    await stripe.subscriptions.update(stripeSubscriptionId, {
                        items: [{ id: itemId, price: newPriceId }],
                        proration_behavior: "none",
                        metadata: { planType: newPlanType, billingInterval: newBillingInterval, scheduledDowngrade: null },
                    });
                    updateData.stripePriceId = newPriceId;
                    updateData.billingInterval = newBillingInterval;
                }
            } catch (stripeErr) {
                logger.error("[Subscription] Failed to update Stripe price on downgrade", {
                    subscriptionId: subscription.id, error: stripeErr.message,
                });
            }

            updateData.planType = newPlanType;
            updateData.therapistLimit = planConfig.therapistLimit ?? 999999;
            updateData.requestLimit = planConfig.requestLimit ?? 999999;
            updateData.cancelReason = null;

            logger.info("[Subscription] Scheduled downgrade applied", {
                subscriptionId: subscription.id,
                from: subscription.planType,
                to: newPlanType,
            });
        }
    }

    await prisma.subscription.update({
        where: { id: subscription.id },
        data: updateData,
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
    const currentPriceId = subItem?.price?.id;

    // If customer resumed their subscription (cancel_at_period_end flipped to false),
    // clear the cancelledAt so the UI reflects the active state
    const resumed = stripeSubscription.cancel_at_period_end === false && subscription.cancelledAt;

    // If customer cancelled via Stripe Billing Portal (cancel_at_period_end flipped to true),
    // set cancelledAt so the UI shows the cancellation banner
    const cancelledViaPortal = stripeSubscription.cancel_at_period_end === true && !subscription.cancelledAt;

    // Detect plan change from Stripe price ID change (e.g., after upgrade/downgrade)
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