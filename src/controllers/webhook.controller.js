import { stripe, stripeConfig } from "../config/stripe.js";
import * as paymentService from "../services/payment.service.js";
import * as subscriptionService from "../services/subscription.service.js";
import { prisma, withAdminAccess } from "../config/prisma.js";
import { sendPaymentFailed, sendPayoutFailed, sendStripeRequirementsAlert, sendCustomerStripeRequirementsAlert } from "../services/email.service.js";
import { logger } from "../config/logger.js";
import { logSystemEvent } from "../services/audit.service.js";
import { trackServerEvent } from "../config/posthog.js";

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
            // Payment Flow
            case "payment_intent.succeeded":
                await handlePaymentIntentSucceeded(event.data.object);
                break;

            case "payment_intent.payment_failed":
                await handlePaymentIntentFailed(event.data.object);
                break;

            case "payment_intent.canceled":
                await handlePaymentIntentCanceled(event.data.object);
                break;

            // Transfer Flow (with recovery)
            case "transfer.created":
                await handleTransferCreatedWithRecovery(event.data.object);
                break;

            case "transfer.reversed":
                await handleTransferReversed(event.data.object);
                break;

            case "transfer.updated":
                await handleTransferUpdated(event.data.object);
                break;

            // Connected Account events
            case "account.updated":
                await handleAccountUpdated(event.data.object, event.account);
                break;

            case "capability.updated":
                // Informational — capability state changes are reflected on the account
                // and picked up by account.updated. No action needed here.
                logger.debug(`[Webhook] capability.updated: ${event.data.object.id} → ${event.data.object.status}`);
                break;

            case "account.external_account.created":
                await handleExternalAccountCreated(event.data.object, event.account);
                break;

            case "account.external_account.deleted":
                await handleExternalAccountDeleted(event.data.object, event.account);
                break;

            case "payout.paid":
                await handlePayoutPaid(event.data.object, event.account);
                break;

            case "payout.failed":
                await handlePayoutFailed(event.data.object, event.account);
                break;

            // Subscription Flow
            case "checkout.session.completed":
                await subscriptionService.handleCheckoutCompleted(event.data.object);
                break;

            case "invoice.paid":
                await subscriptionService.handleInvoicePaid(event.data.object);
                break;

            case "invoice.payment_failed":
                await subscriptionService.handleInvoicePaymentFailed(event.data.object);
                break;

            case "invoice.payment_action_required":
                await subscriptionService.handleInvoicePaymentActionRequired(event.data.object);
                break;

            case "customer.subscription.deleted":
                await subscriptionService.handleSubscriptionDeleted(event.data.object);
                break;

            case "customer.subscription.updated":
                await subscriptionService.handleSubscriptionUpdated(event.data.object);
                break;

            case "subscription_schedule.released":
                await subscriptionService.handleScheduleReleased(event.data.object);
                break;

            case "subscription_schedule.canceled":
                await subscriptionService.handleScheduleCanceled(event.data.object);
                break;

            default:
                logger.debug(`[Webhook] Unhandled event type: ${event.type}`);
        }

        res.json({ received: true, event: event.type });
    } catch (error) {
        logger.error(`[Webhook] Error handling ${event.type}`, { error: error.message });
        res.status(200).json({ received: true, error: error.message, event: event.type });
    }
};

/**
 * Handle successful payment intent — moves booking payment to escrow.
 */
const handlePaymentIntentSucceeded = async (paymentIntent) => {
    try {
        // Skip subscription PaymentIntents — handled by invoice.paid and checkout.session.completed.
        if (paymentIntent.invoice) {
            logger.debug(`[Webhook] Skipping subscription payment_intent.succeeded (invoice: ${paymentIntent.invoice})`);
            return;
        }

        const payment = await paymentService.handlePaymentSuccess(paymentIntent.id);
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
        logger.error("[Webhook] Error handling payment success", { error: error.message });
        throw error;
    }
};

/**
 * Handle failed payment intent — marks payment failed, preserves booking for retry.
 */
const handlePaymentIntentFailed = async (paymentIntent) => {
    try {
        const payment = await prisma.payment.findUnique({
            where: { stripePaymentIntentId: paymentIntent.id },
            include: { booking: { include: { payment: true } } },
        });

        if (!payment) {
            logger.info("[Webhook] No payment record for failed intent", { paymentIntentId: paymentIntent.id });
            return;
        }

        const isActivePayment = payment.booking.payment?.id === payment.id;

        // Mark failed but never cancel the booking — a failed payment is recoverable.
        // createPaymentIntent will detect the failed status and issue a new intent.
        await prisma.payment.update({
            where: { id: payment.id },
            data: { status: "failed" },
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
        logger.error("[Webhook] Error handling payment failure", { error: error.message });
        throw error;
    }
};

/**
 * Handle canceled payment intent — marks payment failed, preserves booking for retry.
 */
const handlePaymentIntentCanceled = async (paymentIntent) => {
    try {
        const payment = await prisma.payment.findUnique({
            where: { stripePaymentIntentId: paymentIntent.id },
        });

        if (!payment || payment.status !== "intent_created") return;

        await prisma.payment.update({
            where: { id: payment.id },
            data: { status: "failed" },
        });

        logger.info("[Webhook] PaymentIntent canceled — booking preserved for retry", {
            paymentIntentId: paymentIntent.id,
            bookingId: payment.bookingId,
        });
    } catch (error) {
        logger.error("[Webhook] Error handling payment cancellation", { error: error.message });
    }
};

const handleTransferReversed = async (transfer) => {
    try {
        const paymentId = transfer.metadata?.paymentId;
        if (paymentId) {
            await prisma.payment.update({
                where: { id: paymentId },
                data: { status: "escrowed", stripeTransferId: null, releasedAt: null },
            });
            logger.info("[Webhook] Transfer reversed — payment reverted to escrowed", { transferId: transfer.id, paymentId });
        }
    } catch (error) {
        logger.error("[Webhook] Error handling transfer reversal", { error: error.message });
    }
};

const handleTransferUpdated = async (transfer) => {
    logger.debug(`[Webhook] transfer.updated: ${transfer.id}`);
};

/**
 * Handle transfer.created with recovery logic.
 * Primary purpose: confirm transfer succeeded.
 * Secondary purpose: recover if the DB update failed after the transfer went through.
 */
const handleTransferCreatedWithRecovery = async (transfer) => {
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

        // RECOVERY: transfer succeeded but DB wasn't updated.
        if (payment.status === "escrowed" && !payment.stripeTransferId) {
            // Admin-initiated transfers handle their own DB updates.
            if (transfer.metadata?.releasedByAdmin) return;

            // Per-session payouts are handled by releaseSessionPayout.
            if (transfer.metadata?.isPerSession === "true") return;

            // Customer refund transfers should never flip the payment to "released".
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

        // Per-session transfers when payment is already partially_released are expected.
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

/** Dispatch to therapist or customer handler based on which profile owns the account. */
const handleAccountUpdated = async (account, accountId) => {
    try {
        const stripeAccountId = accountId || account.id;

        const therapist = await prisma.therapistProfile.findUnique({ where: { stripeAccountId } });
        if (therapist) return handleTherapistAccountUpdated(account, therapist);

        const customer = await prisma.customerProfile.findUnique({ where: { stripeAccountId } });
        if (customer) return handleCustomerAccountUpdated(account, customer);

        logger.debug(`[Webhook] No profile found for Stripe account: ${stripeAccountId}`);
    } catch (error) {
        logger.error("[Webhook] Error handling account.updated", { error: error.message });
    }
};

const handleTherapistAccountUpdated = async (account, therapist) => {
    const isOnboardingComplete = account.details_submitted === true && account.charges_enabled === true;

    if (isOnboardingComplete && !therapist.stripeOnboardingComplete) {
        await withAdminAccess(async (db) => {
            await db.therapistProfile.update({
                where: { stripeAccountId: account.id },
                data: { stripeOnboardingComplete: true },
            });
        });
        logger.info(`[Webhook] Stripe onboarding completed for therapist: ${therapist.fullName}`);
        return;
    }

    if (!isOnboardingComplete && therapist.stripeOnboardingComplete) {
        await withAdminAccess(async (db) => {
            await db.therapistProfile.update({
                where: { stripeAccountId: account.id },
                data: { stripeOnboardingComplete: false },
            });
        });
        logger.info(`[Webhook] Stripe onboarding reverted for therapist: ${therapist.fullName}`);
    }

    // Only alert when onboarding was previously completed. A brand-new account going
    // through onboarding for the first time will have past_due fields simply because
    // nothing has been submitted yet — that is not a restriction. Alerting here would
    // fire "Payout Account Restricted" the moment the therapist selects business type.
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

const handleCustomerAccountUpdated = async (account, customer) => {
    // Customer Connect accounts only need transfers capability (no charges).
    const isOnboardingComplete = account.details_submitted === true && account.payouts_enabled === true;

    if (isOnboardingComplete && !customer.stripeOnboardingComplete) {
        await withAdminAccess(async (db) => {
            await db.customerProfile.update({
                where: { stripeAccountId: account.id },
                data: { stripeOnboardingComplete: true },
            });
        });

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

    if (!isOnboardingComplete && customer.stripeOnboardingComplete) {
        await withAdminAccess(async (db) => {
            await db.customerProfile.update({
                where: { stripeAccountId: account.id },
                data: { stripeOnboardingComplete: false },
            });
        });
        logger.info(`[Webhook] Customer Connect onboarding reverted: ${customer.fullName}`);
    }

    // Only alert when onboarding was previously completed. A brand-new account going
    // through onboarding will have past_due fields simply because nothing has been
    // submitted yet — alerting here would fire "Payout Account Restricted" the moment
    // the customer selects their business type.
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

const handleExternalAccountCreated = async (externalAccount, accountId) => {
    try {
        const therapist = await prisma.therapistProfile.findUnique({ where: { stripeAccountId: accountId } });
        if (therapist) {
            logger.info(`[Webhook] External account added for therapist: ${therapist.fullName}`);
            // TODO: Send bank account confirmation notification to therapist
        }
    } catch (error) {
        logger.error("[Webhook] Error handling external_account.created", { error: error.message });
    }
};

const handleExternalAccountDeleted = async (externalAccount, accountId) => {
    try {
        const therapist = await prisma.therapistProfile.findUnique({ where: { stripeAccountId: accountId } });
        if (therapist) {
            logger.warn(`[Webhook] External account removed for therapist: ${therapist.fullName} — payouts paused until bank account is re-added`);
            // TODO: Send urgent notification to therapist to re-add bank account
        }
    } catch (error) {
        logger.error("[Webhook] Error handling external_account.deleted", { error: error.message });
    }
};

const handlePayoutPaid = async (payout, accountId) => {
    try {
        const therapist = await prisma.therapistProfile.findUnique({ where: { stripeAccountId: accountId } });
        if (therapist) {
            logger.info(`[Webhook] Payout of $${payout.amount / 100} delivered to therapist: ${therapist.fullName}`);
        }
    } catch (error) {
        logger.error("[Webhook] Error handling payout.paid", { error: error.message });
    }
};

const handlePayoutFailed = async (payout, accountId) => {
    try {
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

            // NOTE: Payment status stays "released" — money remains in Stripe balance.
            // Stripe will retry the payout automatically.
        }
    } catch (error) {
        logger.error("[Webhook] Error handling payout.failed", { error: error.message });
    }
};

export { handleStripeWebhook };
