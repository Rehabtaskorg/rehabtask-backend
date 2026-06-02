import { SUBSCRIPTION_STATUS } from "../utils/constants.js";
import { prisma } from "../config/prisma.js";
import { stripe } from "../config/stripe.js";
import { sendSubscriptionActivated, sendSubscriptionPaymentFailed, sendSubscriptionUpgraded } from "./email.service.js";
import { logger } from "../config/logger.js";
import { PLAN_CONFIG, GRACE_PERIOD_DAYS, getPlanFromPriceId } from "../config/subscriptionPlans.js";
import { logSystemEvent } from "./audit.service.js";
import { trackServerEvent } from "../config/posthog.js";
import { TIME_MS } from "../utils/constants.js";
import { parseStripeDate } from "./subscription.helpers.js";

/**
 * Handle checkout.session.completed webhook.
 * Finds existing trial/free subscription and upgrades it, or creates new.
 * @param {object} session - Stripe CheckoutSession object
 */
export const handleCheckoutCompleted = async (session) => {
    if (session.mode !== "subscription") return;

    const { customerId, planType, billingInterval } = session.metadata;
    if (!customerId || !planType) {
        logger.warn("[Subscription] checkout.session.completed missing metadata", { sessionId: session.id, metadata: session.metadata });
        return;
    }

    const stripeSubscriptionId = session.subscription;

    const alreadyProcessed = await prisma.subscription.findFirst({ where: { stripeSubscriptionId } });
    if (alreadyProcessed) {
        logger.info("[Subscription] checkout.session.completed already processed", { stripeSubscriptionId, existingId: alreadyProcessed.id });
        return;
    }

    const stripeSubscription = await stripe.subscriptions.retrieve(stripeSubscriptionId);
    const subscriptionItem = stripeSubscription.items?.data?.[0];
    const { requestLimit, therapistLimit } = PLAN_CONFIG[planType] || PLAN_CONFIG.free;

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

    const subscription = existing
        ? await prisma.subscription.update({ where: { id: existing.id }, data })
        : await prisma.subscription.create({ data: { ...data, customerId } });

    try {
        const customer = await prisma.customerProfile.findUnique({
            where: { id: customerId },
            include: { user: true },
        });
        if (customer) {
            await sendSubscriptionActivated({ customer, subscription });
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
 * Also applies 3DS-deferred plan upgrades via metadata detection.
 * @param {object} invoice - Stripe Invoice object
 */
export const handleInvoicePaid = async (invoice) => {
    const stripeSubscriptionId = invoice.subscription;
    if (!stripeSubscriptionId) return;

    const subscription = await prisma.subscription.findFirst({ where: { stripeSubscriptionId } });
    if (!subscription) {
        logger.warn("[Subscription] invoice.paid — no matching subscription", { stripeSubscriptionId });
        return;
    }

    const periodEnd = parseStripeDate(invoice.lines?.data[0]?.period?.end);
    const stripeSub = await stripe.subscriptions.retrieve(stripeSubscriptionId);
    const stripePlanType = stripeSub.metadata?.planType;
    const hasPlanChange = stripePlanType && stripePlanType !== subscription.planType;

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

    await prisma.subscription.update({ where: { id: subscription.id }, data: updateData });

    logSystemEvent({
        action: hasPlanChange ? "subscription.upgraded" : "subscription.renewed",
        entityType: "subscription",
        entityId: subscription.id,
        changes: { stripeSubscriptionId, periodEnd, planType: updateData.planType ?? subscription.planType },
    });

    if (hasPlanChange) {
        prisma.customerProfile.findUnique({
            where: { id: subscription.customerId },
            include: { user: true },
        }).then((customer) => {
            if (customer) sendSubscriptionUpgraded({ customer, subscription: { ...subscription, ...updateData } }).catch(() => { });
        }).catch(() => { });
    }

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
 * @param {object} invoice - Stripe Invoice object
 */
export const handleInvoicePaymentFailed = async (invoice) => {
    const stripeSubscriptionId = invoice.subscription;
    if (!stripeSubscriptionId) return;

    const subscription = await prisma.subscription.findFirst({ where: { stripeSubscriptionId } });
    if (!subscription) return;

    await prisma.subscription.update({
        where: { id: subscription.id },
        data: { status: SUBSCRIPTION_STATUS.PAST_DUE },
    });

    try {
        const customer = await prisma.customerProfile.findUnique({
            where: { id: subscription.customerId },
            include: { user: true },
        });
        if (customer) {
            await sendSubscriptionPaymentFailed({ customer });
            if (customer.user?.id) {
                trackServerEvent(customer.user.id, "subscription_payment_failed", { plan_type: subscription.planType });
            }
        }
    } catch (err) {
        logger.error("[Subscription] Failed to send payment failed email", { error: err.message });
    }

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
 * Starts a grace period before downgrading to free.
 * @param {object} stripeSubscription - Stripe Subscription object
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

    logSystemEvent({
        action: "subscription.canceled",
        entityType: "subscription",
        entityId: subscription.id,
        changes: { previousPlan: subscription.planType, gracePeriodEndsAt },
    });

    prisma.customerProfile.findUnique({
        where: { id: subscription.customerId },
        select: { user: { select: { id: true } } },
    }).then((customer) => {
        if (customer?.user?.id) {
            trackServerEvent(customer.user.id, "subscription_cancelled", { plan_type: subscription.planType });
        }
    }).catch(() => { });

    logger.info("[Subscription] Deleted — entering grace period", { subscriptionId: subscription.id, gracePeriodEndsAt });
};

/**
 * Handle customer.subscription.updated webhook.
 * Syncs status, period dates, and detects external plan changes from Stripe.
 * @param {object} stripeSubscription - Stripe Subscription object
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
                stripeScheduleId: null,
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

    if (resumed) logger.info("[Subscription] Customer resumed subscription", { subscriptionId: subscription.id });
    if (cancelledViaPortal) logger.info("[Subscription] Customer cancelled via Stripe portal", { subscriptionId: subscription.id });

    logger.info("[Subscription] Updated from Stripe", {
        subscriptionId: subscription.id,
        stripeStatus: stripeSubscription.status,
        mappedStatus,
    });
};

/**
 * Handle subscription_schedule.released webhook.
 * Clears stripeScheduleId when Stripe releases the schedule after the final phase completes.
 * @param {object} schedule - Stripe SubscriptionSchedule object
 */
export const handleScheduleReleased = async (schedule) => {
    const subscription = await prisma.subscription.findFirst({ where: { stripeScheduleId: schedule.id } });
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
 * Clears stripeScheduleId when a schedule is explicitly canceled in Stripe.
 * @param {object} schedule - Stripe SubscriptionSchedule object
 */
export const handleScheduleCanceled = async (schedule) => {
    const subscription = await prisma.subscription.findFirst({ where: { stripeScheduleId: schedule.id } });
    if (!subscription) return;

    await prisma.subscription.update({
        where: { id: subscription.id },
        data: { stripeScheduleId: null },
    });

    logger.warn("[Subscription] Schedule canceled", {
        subscriptionId: subscription.id, scheduleId: schedule.id,
    });
};
