// TODO: [BUG] This file is 562 lines — exceeds the 150-line controller limit.
// Split into webhook.payment.controller.js, webhook.subscription.controller.js,
// webhook.connect.controller.js in a follow-up PR.
// TODO: [NEXT] Only handlePaymentIntentSucceeded and handlePaymentIntentFailed rethrow,
// so the retry classification in the outer catch governs those two alone. Every other
// handler swallows its own errors, meaning a DB outage during e.g. handleTransferReversed
// is still acknowledged with a 200 and dropped. Decide per handler whether to rethrow —
// deferred from Phase A because it widens retry behaviour across payouts, transfers and
// account updates at once, which needs its own soak on dev.
import { stripe, stripeConfig } from "../config/stripe.js";
import * as paymentService from "../services/payment.service.js";
import * as subscriptionService from "../services/subscription.service.js";
import { prisma } from "../config/prisma.js";
import { sendPaymentFailed, sendPayoutFailed, sendStripeRequirementsAlert, sendCustomerStripeRequirementsAlert } from "../services/email.service.js";
import { logger } from "../config/logger.js";
import { logSystemEvent } from "../services/audit.service.js";
import { trackServerEvent } from "../config/posthog.js";
import { isConnectAccountReady, isDuplicateWebhookEventError, classifyWebhookError } from "../utils/stripe.helpers.js";

/**
 * Atomically marks a Stripe event as processed inside an existing transaction.
 * Throws P2002 (unique constraint) if the event was already handled — the caller's
 * transaction rolls back, making the entire handler a no-op on duplicate delivery.
 *
 * @param {object} tx - Prisma transaction client
 * @param {string} stripeEventId - Stripe event ID (evt_...)
 * @param {string} eventType - Stripe event type string
 */
async function markEventProcessed(tx, stripeEventId, eventType) {
    await tx.processedWebhookEvent.create({
        data: { stripeEventId, eventType },
    });
}

/**
 * Main Stripe webhook handler.
 * Supports both platform events and connected account events.
 * Tries the platform secret first, then the Connect secret.
 */
const handleStripeWebhook = async (req, res) => {
    const sig = req.headers["stripe-signature"];
    let event;

    try {
        event = stripe.webhooks.constructEvent(req.body, sig, stripeConfig.webhookSecret);
    } catch {
        try {
            event = stripe.webhooks.constructEvent(req.body, sig, stripeConfig.webhookSecretConnect);
        } catch (err2) {
            logger.warn("[Webhook] Signature verification failed", { error: err2.message });
            return res.status(400).send(`Webhook Error: ${err2.message}`);
        }
    }

    try {
        switch (event.type) {
            case "payment_intent.succeeded":
                await handlePaymentIntentSucceeded(event.data.object, event.id);
                break;

            case "payment_intent.payment_failed":
                await handlePaymentIntentFailed(event.data.object, event.id);
                break;

            case "payment_intent.canceled":
                await handlePaymentIntentCanceled(event.data.object, event.id);
                break;

            case "transfer.created":
                await handleTransferCreatedWithRecovery(event.data.object, event.id);
                break;

            case "transfer.reversed":
                await handleTransferReversed(event.data.object, event.id);
                break;

            case "transfer.updated":
                await handleTransferUpdated(event.data.object, event.id);
                break;

            case "account.updated":
                await handleAccountUpdated(event.data.object, event.account, event.id);
                break;

            case "capability.updated":
                logger.debug(`[Webhook] capability.updated: ${event.data.object.id} → ${event.data.object.status}`);
                break;

            case "account.external_account.created":
                await handleExternalAccountCreated(event.data.object, event.account, event.id);
                break;

            case "account.external_account.deleted":
                await handleExternalAccountDeleted(event.data.object, event.account, event.id);
                break;

            case "payout.paid":
                await handlePayoutPaid(event.data.object, event.account, event.id);
                break;

            case "payout.failed":
                await handlePayoutFailed(event.data.object, event.account, event.id);
                break;

            case "checkout.session.completed":
                await subscriptionService.handleCheckoutCompleted(event.data.object, event.id);
                break;

            case "invoice.paid":
                await subscriptionService.handleInvoicePaid(event.data.object, event.id);
                break;

            case "invoice.payment_failed":
                await subscriptionService.handleInvoicePaymentFailed(event.data.object, event.id);
                break;

            case "invoice.payment_action_required":
                await subscriptionService.handleInvoicePaymentActionRequired(event.data.object, event.id);
                break;

            case "customer.subscription.deleted":
                await subscriptionService.handleSubscriptionDeleted(event.data.object, event.id);
                break;

            case "customer.subscription.updated":
                await subscriptionService.handleSubscriptionUpdated(event.data.object, event.id);
                break;

            case "subscription_schedule.released":
                await subscriptionService.handleScheduleReleased(event.data.object, event.id);
                break;

            case "subscription_schedule.canceled":
                await subscriptionService.handleScheduleCanceled(event.data.object, event.id);
                break;

            default:
                logger.debug(`[Webhook] Unhandled event type: ${event.type}`);
        }

        res.json({ received: true, event: event.type });
    } catch (error) {
        const { shouldRetry, reason } = classifyWebhookError(error);

        logger.error(`[Webhook] Error handling ${event.type}`, {
            error: error.message,
            eventId: event.id,
            shouldRetry,
            reason,
        });

        if (shouldRetry) {
            res.status(500).json({ received: false, event: event.type });
            return;
        }

        res.status(200).json({ received: true, event: event.type });
    }
};

/**
 * Handle successful payment intent — moves booking payment to escrow.
 *
 * @param {object} paymentIntent - Stripe PaymentIntent object
 * @param {string} stripeEventId - Stripe event ID for deduplication
 */
const handlePaymentIntentSucceeded = async (paymentIntent, stripeEventId) => {
    try {
        if (paymentIntent.invoice) {
            logger.debug(`[Webhook] Skipping subscription payment_intent.succeeded (invoice: ${paymentIntent.invoice})`);
            return;
        }

        const payment = await paymentService.handlePaymentSuccess(paymentIntent.id, stripeEventId);
        logger.info("[Webhook] Payment moved to escrow", { paymentIntentId: paymentIntent.id });

        if (payment?.bookingId) {
            prisma.booking.findUnique({
                where: { id: payment.bookingId },
                select: {
                    sessionType: true,
                    customer: { select: { user: { select: { id: true } } } },
                },
            }).then((booking) => {
                if (booking?.customer?.user?.id) {
                    trackServerEvent(booking.customer.user.id, "payment_confirmed", {
                        session_type: booking.sessionType,
                        amount: parseFloat(payment.amount),
                    });
                }
            }).catch(() => { });
        }
    } catch (error) {
        if (isDuplicateWebhookEventError(error)) {
            logger.info("[Webhook] Duplicate payment_intent.succeeded — already processed", { paymentIntentId: paymentIntent.id });
            return;
        }
        logger.error("[Webhook] Error handling payment success", { error: error.message });
        throw error;
    }
};

/**
 * Handle failed payment intent — marks payment failed, preserves booking for retry.
 *
 * @param {object} paymentIntent - Stripe PaymentIntent object
 * @param {string} stripeEventId - Stripe event ID for deduplication
 */
const handlePaymentIntentFailed = async (paymentIntent, stripeEventId) => {
    try {
        const payment = await prisma.payment.findUnique({
            where: { stripePaymentIntentId: paymentIntent.id },
            include: { booking: { include: { payment: true } } },
        });

        if (!payment) {
            logger.info("[Webhook] No payment record for failed intent", { paymentIntentId: paymentIntent.id });
            return;
        }

        if (!payment.booking) {
            logger.warn("[Webhook] Payment has no booking relation — skipping failure handling", {
                paymentIntentId: paymentIntent.id,
                paymentId: payment.id,
                bookingId: payment.bookingId,
            });
            return;
        }

        const isActivePayment = payment.booking.payment?.id === payment.id;

        await prisma.$transaction(async (tx) => {
            await markEventProcessed(tx, stripeEventId, "payment_intent.payment_failed");

            await tx.payment.update({
                where: { id: payment.id },
                data: { status: "failed" },
            });
        });

        if (isActivePayment) {
            sendPaymentFailed({
                customer: { ...payment.booking, user: null },
                booking: payment.booking,
                reason: paymentIntent.last_payment_error?.message,
            }).catch(() => { });

            prisma.booking.findUnique({
                where: { id: payment.bookingId },
                select: { customer: { select: { user: { select: { id: true } } } } },
            }).then((booking) => {
                if (booking?.customer?.user?.id) {
                    trackServerEvent(booking.customer.user.id, "payment_failed", {
                        booking_id: payment.bookingId,
                    });
                }
            }).catch(() => { });
        }

        logSystemEvent({
            action: "payment.failed",
            entityType: "payment",
            entityId: payment.id,
            changes: {
                bookingId: payment.bookingId,
                isActivePayment,
                reason: paymentIntent.last_payment_error?.message || "Payment failed",
                stripePaymentIntentId: paymentIntent.id,
            },
        });

        logger.info("[Webhook] PaymentIntent failed — booking preserved for retry", {
            paymentIntentId: paymentIntent.id,
            bookingId: payment.bookingId,
            isActivePayment,
        });
    } catch (error) {
        if (isDuplicateWebhookEventError(error)) {
            logger.info("[Webhook] Duplicate payment_intent.payment_failed — already processed", { paymentIntentId: paymentIntent.id });
            return;
        }
        logger.error("[Webhook] Error handling payment failure", { error: error.message });
        throw error;
    }
};

/**
 * Handle canceled payment intent — marks payment failed, preserves booking for retry.
 *
 * @param {object} paymentIntent - Stripe PaymentIntent object
 * @param {string} stripeEventId - Stripe event ID for deduplication
 */
const handlePaymentIntentCanceled = async (paymentIntent, stripeEventId) => {
    try {
        const payment = await prisma.payment.findUnique({
            where: { stripePaymentIntentId: paymentIntent.id },
        });

        if (!payment || payment.status !== "intent_created") return;

        await prisma.$transaction(async (tx) => {
            await markEventProcessed(tx, stripeEventId, "payment_intent.canceled");
            await tx.payment.update({
                where: { id: payment.id },
                data: { status: "failed" },
            });
        });

        logger.info("[Webhook] PaymentIntent canceled — booking preserved for retry", {
            paymentIntentId: paymentIntent.id,
            bookingId: payment.bookingId,
        });
    } catch (error) {
        if (isDuplicateWebhookEventError(error)) {
            logger.info("[Webhook] Duplicate payment_intent.canceled — already processed", { paymentIntentId: paymentIntent.id });
            return;
        }
        logger.error("[Webhook] Error handling payment cancellation", { error: error.message });
    }
};

/**
 * @param {object} transfer - Stripe Transfer object
 * @param {string} stripeEventId - Stripe event ID for deduplication
 */
const handleTransferReversed = async (transfer, stripeEventId) => {
    try {
        const paymentId = transfer.metadata?.paymentId;
        if (!paymentId) return;

        await prisma.$transaction(async (tx) => {
            await markEventProcessed(tx, stripeEventId, "transfer.reversed");
            await tx.payment.update({
                where: { id: paymentId },
                data: { status: "escrowed", stripeTransferId: null, releasedAt: null },
            });
        });

        logger.info("[Webhook] Transfer reversed — payment reverted to escrowed", { transferId: transfer.id, paymentId });
    } catch (error) {
        if (isDuplicateWebhookEventError(error)) {
            logger.info("[Webhook] Duplicate transfer.reversed — already processed", { transferId: transfer.id });
            return;
        }
        logger.error("[Webhook] Error handling transfer reversal", { error: error.message });
    }
};

/**
 * @param {object} transfer - Stripe Transfer object
 * @param {string} stripeEventId - Stripe event ID for deduplication
 */
const handleTransferUpdated = async (transfer, stripeEventId) => {
    try {
        await prisma.processedWebhookEvent.create({
            data: { stripeEventId, eventType: "transfer.updated" },
        });
        logger.debug(`[Webhook] transfer.updated: ${transfer.id}`);
    } catch (error) {
        if (isDuplicateWebhookEventError(error)) return;
        logger.error("[Webhook] Error handling transfer.updated", { error: error.message });
    }
};

/**
 * Handle transfer.created with recovery logic.
 * Primary purpose: confirm transfer succeeded.
 * Secondary purpose: recover if the DB update failed after the transfer went through.
 *
 * @param {object} transfer - Stripe Transfer object
 * @param {string} stripeEventId - Stripe event ID for deduplication
 */
const handleTransferCreatedWithRecovery = async (transfer, stripeEventId) => {
    try {
        await prisma.processedWebhookEvent.create({
            data: { stripeEventId, eventType: "transfer.created" },
        });
    } catch (error) {
        if (isDuplicateWebhookEventError(error)) {
            logger.info("[Webhook] Duplicate transfer.created — already processed", { transferId: transfer.id });
            return;
        }
        logger.error("[Webhook] Error handling transfer.created", { error: error.message });
        return;
    }

    try {
        const paymentId = transfer.metadata?.paymentId;

        if (!paymentId) {
            logger.debug(`[Webhook] transfer.created has no paymentId metadata — skipping`, { transferId: transfer.id });
            return;
        }

        const payment = await prisma.payment.findUnique({
            where: { id: paymentId },
            include: { booking: { include: { therapist: true, customer: true } } },
        });

        if (!payment) {
            logger.warn("[Webhook] Payment not found for transfer", { paymentId, transferId: transfer.id });
            return;
        }

        if (payment.status === "escrowed" && !payment.stripeTransferId) {
            if (transfer.metadata?.releasedByAdmin) return;
            if (transfer.metadata?.isPerSession === "true") return;
            if (transfer.metadata?.type === "customer_refund") return;

            try {
                const verifiedTransfer = await stripe.transfers.retrieve(transfer.id);

                if (verifiedTransfer.reversed) return;
                if (!verifiedTransfer.amount || verifiedTransfer.amount <= 0) return;

                await prisma.payment.update({
                    where: { id: payment.id },
                    data: { status: "released", stripeTransferId: transfer.id, releasedAt: new Date() },
                });

                logger.info("[Webhook] Payment recovered and marked as released", { paymentId: payment.id, transferId: transfer.id });
            } catch (recoveryError) {
                logger.error("[Webhook] Recovery failed — MANUAL INTERVENTION REQUIRED", {
                    paymentId: payment.id,
                    transferId: transfer.id,
                    error: recoveryError.message,
                });
                // TODO: CRITICAL — alert admin immediately and create support ticket
            }
            return;
        }

        if (payment.status === "partially_released" && transfer.metadata?.isPerSession === "true") return;

        if (payment.status !== "escrowed" && payment.status !== "released") {
            logger.warn("[Webhook] Unexpected payment status on transfer.created — manual review may be needed", {
                paymentStatus: payment.status,
                paymentId: payment.id,
                transferId: transfer.id,
            });
        }
    } catch (error) {
        logger.error("[Webhook] Error handling transfer.created", { error: error.message });
    }
};

/**
 * Dispatch to therapist or customer handler based on which profile owns the account.
 *
 * @param {object} account - Stripe Account object
 * @param {string} accountId - Connected account ID
 * @param {string} stripeEventId - Stripe event ID for deduplication
 */
const handleAccountUpdated = async (account, accountId, stripeEventId) => {
    try {
        const stripeAccountId = accountId || account.id;

        const therapist = await prisma.therapistProfile.findUnique({ where: { stripeAccountId } });
        if (therapist) return handleTherapistAccountUpdated(account, therapist, stripeEventId);

        const customer = await prisma.customerProfile.findUnique({ where: { stripeAccountId } });
        if (customer) return handleCustomerAccountUpdated(account, customer, stripeEventId);

        logger.debug(`[Webhook] No profile found for Stripe account: ${stripeAccountId}`);
    } catch (error) {
        if (isDuplicateWebhookEventError(error)) {
            logger.info("[Webhook] Duplicate account.updated — already processed", { accountId });
            return;
        }
        logger.error("[Webhook] Error handling account.updated", { error: error.message });
    }
};

/**
 * @param {object} account - Stripe Account object
 * @param {object} therapist - TherapistProfile row
 * @param {string} stripeEventId - Stripe event ID for deduplication
 */
const handleTherapistAccountUpdated = async (account, therapist, stripeEventId) => {
    const isOnboardingComplete = isConnectAccountReady(account);
    const hasChanged = isOnboardingComplete !== therapist.stripeOnboardingComplete;

    await prisma.$transaction(async (tx) => {
        await markEventProcessed(tx, stripeEventId, "account.updated");
        if (hasChanged) {
            await tx.therapistProfile.update({
                where: { stripeAccountId: account.id },
                data: { stripeOnboardingComplete: isOnboardingComplete },
            });
        }
    });

    if (hasChanged) {
        logger.info(`[Webhook] Stripe onboarding ${isOnboardingComplete ? "completed" : "reverted"} for therapist: ${therapist.fullName}`);
    }

    if (!account.details_submitted) return;

    const req = account.requirements ?? {};
    const futureReq = account.future_requirements ?? {};
    const pastDueCount = req.past_due?.length ?? 0;
    const currentlyDueCount = req.currently_due?.length ?? 0;
    const futureDueCount =
        (req.eventually_due?.length ?? 0) +
        (futureReq.currently_due?.length ?? 0) +
        (futureReq.eventually_due?.length ?? 0);

    if (pastDueCount > 0 || currentlyDueCount > 0 || futureDueCount > 0) {
        const therapistWithUser = await prisma.therapistProfile.findUnique({
            where: { id: therapist.id },
            include: { user: { select: { email: true } } },
        });

        if (therapistWithUser?.user?.email) {
            sendStripeRequirementsAlert({
                therapist: therapistWithUser,
                pastDueCount,
                currentlyDueCount,
                currentDeadline: req.current_deadline ?? null,
                hasUpcomingRequirements: futureDueCount > 0,
                futureDeadline: futureReq.current_deadline ?? null,
            }).catch((err) => {
                logger.error("[Webhook] Failed to send Stripe requirements alert email", {
                    therapistId: therapist.id,
                    error: err.message,
                });
            });
        }
    }
};

/**
 * @param {object} account - Stripe Account object
 * @param {object} customer - CustomerProfile row
 * @param {string} stripeEventId - Stripe event ID for deduplication
 */
const handleCustomerAccountUpdated = async (account, customer, stripeEventId) => {
    const isOnboardingComplete = isConnectAccountReady(account);
    const justCompleted = isOnboardingComplete && !customer.stripeOnboardingComplete;
    const justReverted = !isOnboardingComplete && customer.stripeOnboardingComplete;

    await prisma.$transaction(async (tx) => {
        await markEventProcessed(tx, stripeEventId, "account.updated");
        if (justCompleted || justReverted) {
            await tx.customerProfile.update({
                where: { stripeAccountId: account.id },
                data: { stripeOnboardingComplete: isOnboardingComplete },
            });
        }
    });

    if (justCompleted) {
        logger.info(`[Webhook] Customer Connect onboarding completed: ${customer.fullName} (${customer.id})`);

        try {
            const results = await paymentService.processPendingRefundsForCustomer(customer.id);
            if (results.length > 0) {
                logger.info(`[Webhook] Auto-transferred ${results.filter(r => r.status === "transferred").length} pending refunds for customer ${customer.id}`);
            }
        } catch (err) {
            logger.error(`[Webhook] Failed to auto-transfer pending refunds for customer ${customer.id}`, { error: err.message });
        }

        return;
    }

    if (justReverted) {
        logger.info(`[Webhook] Customer Connect onboarding reverted: ${customer.fullName}`);
    }

    if (!account.details_submitted) return;

    const req = account.requirements ?? {};
    const futureReq = account.future_requirements ?? {};
    const pastDueCount = req.past_due?.length ?? 0;
    const currentlyDueCount = req.currently_due?.length ?? 0;
    const futureDueCount =
        (req.eventually_due?.length ?? 0) +
        (futureReq.currently_due?.length ?? 0) +
        (futureReq.eventually_due?.length ?? 0);

    if (pastDueCount > 0 || currentlyDueCount > 0 || futureDueCount > 0) {
        const customerWithUser = await prisma.customerProfile.findUnique({
            where: { id: customer.id },
            include: { user: { select: { email: true } } },
        });

        if (customerWithUser?.user?.email) {
            sendCustomerStripeRequirementsAlert({
                customer: customerWithUser,
                pastDueCount,
                currentlyDueCount,
                currentDeadline: req.current_deadline ?? null,
                hasUpcomingRequirements: futureDueCount > 0,
                futureDeadline: futureReq.current_deadline ?? null,
            }).catch((err) => {
                logger.error("[Webhook] Failed to send customer Stripe requirements alert email", {
                    customerId: customer.id,
                    error: err.message,
                });
            });
        }
    }
};

/**
 * @param {object} externalAccount - Stripe ExternalAccount object
 * @param {string} accountId - Connected account ID
 * @param {string} stripeEventId - Stripe event ID for deduplication
 */
const handleExternalAccountCreated = async (externalAccount, accountId, stripeEventId) => {
    try {
        await prisma.processedWebhookEvent.create({ data: { stripeEventId, eventType: "account.external_account.created" } });
        const therapist = await prisma.therapistProfile.findUnique({ where: { stripeAccountId: accountId } });
        if (therapist) {
            logger.info(`[Webhook] External account added for therapist: ${therapist.fullName}`);
            // TODO: Send bank account confirmation notification to therapist
        }
    } catch (error) {
        if (isDuplicateWebhookEventError(error)) return;
        logger.error("[Webhook] Error handling external_account.created", { error: error.message });
    }
};

/**
 * @param {object} externalAccount - Stripe ExternalAccount object
 * @param {string} accountId - Connected account ID
 * @param {string} stripeEventId - Stripe event ID for deduplication
 */
const handleExternalAccountDeleted = async (externalAccount, accountId, stripeEventId) => {
    try {
        await prisma.processedWebhookEvent.create({ data: { stripeEventId, eventType: "account.external_account.deleted" } });
        const therapist = await prisma.therapistProfile.findUnique({ where: { stripeAccountId: accountId } });
        if (therapist) {
            logger.warn(`[Webhook] External account removed for therapist: ${therapist.fullName} — payouts paused until bank account is re-added`);
            // TODO: Send urgent notification to therapist to re-add bank account
        }
    } catch (error) {
        if (isDuplicateWebhookEventError(error)) return;
        logger.error("[Webhook] Error handling external_account.deleted", { error: error.message });
    }
};

/**
 * @param {object} payout - Stripe Payout object
 * @param {string} accountId - Connected account ID
 * @param {string} stripeEventId - Stripe event ID for deduplication
 */
const handlePayoutPaid = async (payout, accountId, stripeEventId) => {
    try {
        await prisma.processedWebhookEvent.create({ data: { stripeEventId, eventType: "payout.paid" } });
        const therapist = await prisma.therapistProfile.findUnique({ where: { stripeAccountId: accountId } });
        if (therapist) {
            logger.info(`[Webhook] Payout of $${payout.amount / 100} delivered to therapist: ${therapist.fullName}`);
        }
    } catch (error) {
        if (isDuplicateWebhookEventError(error)) return;
        logger.error("[Webhook] Error handling payout.paid", { error: error.message });
    }
};

/**
 * @param {object} payout - Stripe Payout object
 * @param {string} accountId - Connected account ID
 * @param {string} stripeEventId - Stripe event ID for deduplication
 */
const handlePayoutFailed = async (payout, accountId, stripeEventId) => {
    try {
        await prisma.$transaction(async (tx) => {
            await markEventProcessed(tx, stripeEventId, "payout.failed");
        });

        const therapist = await prisma.therapistProfile.findUnique({
            where: { stripeAccountId: accountId },
            include: { user: { select: { email: true } } },
        });

        if (therapist) {
            logger.warn(`[Webhook] Payout failed for therapist: ${therapist.fullName}`, { reason: payout.failure_message });
            sendPayoutFailed({
                therapist,
                amount: payout.amount / 100,
                reason: payout.failure_message,
            }).catch(() => { });
            return;
        }

        const customer = await prisma.customerProfile.findUnique({
            where: { stripeAccountId: accountId },
            include: { user: { select: { email: true } } },
        });

        if (customer) {
            logger.warn(`[Webhook] Payout failed for customer: ${customer.fullName}`, {
                failureCode: payout.failure_code,
                reason: payout.failure_message,
            });
            await paymentService.handleCustomerPayoutFailed(customer, payout);
            return;
        }

        logger.warn("[Webhook] payout.failed received for unknown Stripe account", { accountId });
    } catch (error) {
        if (isDuplicateWebhookEventError(error)) {
            logger.info("[Webhook] Duplicate payout.failed — already processed", { accountId });
            return;
        }
        logger.error("[Webhook] Error handling payout.failed", { error: error.message });
    }
};

export { handleStripeWebhook };
