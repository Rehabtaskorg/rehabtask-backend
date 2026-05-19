import { stripe, stripeConfig } from "../config/stripe.js";
import * as paymentService from "../services/payment.service.js";
import * as subscriptionService from "../services/subscription.service.js";
import { prisma, withAdminAccess } from "../config/prisma.js";
import { sendPaymentFailed, sendPayoutFailed, sendStripeRequirementsAlert, sendCustomerStripeRequirementsAlert } from "../services/email.service.js";
import { logger } from "../config/logger.js";
import { logSystemEvent } from "../services/audit.service.js";

/**
 * Handle Stripe webhooks
 * Supports both Platform events and Connected Account events
 */
const handleStripeWebhook = async (req, res) => {
    const sig = req.headers["stripe-signature"];
    let event;

    // Try platform webhook secret first
    try {
        event = stripe.webhooks.constructEvent(req.body, sig, stripeConfig.webhookSecret);
    } catch (err) {
        try {
            event = stripe.webhooks.constructEvent(req.body, sig, stripeConfig.webhookSecretConnect);
        } catch (err2) {
            console.error("Webhook signature verification failed:", err.message);
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

            // (Connected Accounts)

            case "account.updated":
                await handleAccountUpdated(event.data.object, event.account);
                break;

            case "capability.updated":
                // Informational — capability state changes are reflected on the account
                // and picked up by account.updated. Just log and ack.
                console.log(`Capability ${event.data.object.id} updated → status: ${event.data.object.status}`);
                break;

            case "account.external_account.created":
                await handleExternalAccountCreated(event.data.object, event.account);
                break;

            case "account.external_account.deleted":
                await handleExternalAccountDeleted(event.data.object, event.account);
                break;

            case "payout.paid":
                // Send notification: "Your money arrived in bank!"
                await handlePayoutPaid(event.data.object, event.account);
                break;

            case "payout.failed":
                // ALert therapist: "Update your bank details"
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

            case "customer.subscription.deleted":
                await subscriptionService.handleSubscriptionDeleted(event.data.object);
                break;

            case "customer.subscription.updated":
                await subscriptionService.handleSubscriptionUpdated(event.data.object);
                break;

            default:
                console.log(`Unhandled event type:${event.type}`);
        }

        res.json({ received: true, event: event.type });
    } catch (error) {
        console.error(`Error handling webhook ${event.type}:`, error);
        res.status(200).json({
            received: true,
            error: error.message,
            event: event.type,
        });
    }

}

/**
 * Handle successful payment intent
 * This is triggered when customer successfully pays
 */
const handlePaymentIntentSucceeded = async (paymentIntent) => {
    try {
        // Skip subscription-related PaymentIntents — they don't have booking Payment records.
        // Subscription payments are handled by invoice.paid and checkout.session.completed.
        if (paymentIntent.invoice) {
            console.log(`Skipping subscription payment_intent.succeeded (invoice: ${paymentIntent.invoice})`);
            return;
        }

        await paymentService.handlePaymentSuccess(paymentIntent.id);
        console.log("Payment moved to escrow successfully");
    } catch (error) {
        console.error("Error handling payment success:", error);
        throw error;
    }
}

/**
 * Handle failed payment intent
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

        // Mark the payment record as failed, but NEVER cancel the booking.
        // A failed payment is recoverable — the customer can retry with a
        // different card. The createPaymentIntent reuse pattern will detect
        // the failed status and create a new intent on the next attempt.
        // Only explicit user/admin cancellation should cancel a booking.
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
        console.error("Error handling payment failure:", error);
        throw error;
    }
}

/**
 * Handle canceled payment intent
 */
const handlePaymentIntentCanceled = async (paymentIntent) => {
    try {
        const payment = await prisma.payment.findUnique({
            where: { stripePaymentIntentId: paymentIntent.id },
        });

        if (!payment || payment.status !== "intent_created") return;

        // Mark payment as failed but preserve the booking for retry.
        // The createPaymentIntent reuse pattern will detect the failed
        // status and create a new intent on the customer's next attempt.
        await prisma.payment.update({
            where: { id: payment.id },
            data: { status: "failed" },
        });

        logger.info("[Webhook] PaymentIntent canceled — booking preserved for retry", {
            paymentIntentId: paymentIntent.id,
            bookingId: payment.bookingId,
        });
    } catch (error) {
        console.error("Error handling payment cancellation:", error.message);
    }
}

const handleTransferReversed = async (transfer) => {
    try {
        console.log(`Transfer reversed: ${transfer.id}`);
        const paymentId = transfer.metadata?.paymentId;

        if (paymentId) {
            await prisma.payment.update({
                where: { id: paymentId },
                data: {
                    status: "escrowed",
                    stripeTransferId: null,
                    releasedAt: null,
                }
            });
            console.log(`Payment reverted to escrowed`);
        }

    } catch (error) {
        console.error(`Error: ${error.message}`)
    }
}

const handleTransferUpdated = async (transfer) => {
    try {
        console.log(`Transfer updated: ${transfer.id}`);
        // Transfer updates usually just status changes - for monitoring
    } catch (error) {
        console.error(`Error: ${error.message}`);
    }
}

/**
 * Handle failed transfer
 */
const _handleTransferFailed = async (transfer) => {
    console.log("Transfer failed:", transfer.id);

    try {
        const payment = await prisma.payment.findUnique({
            where: { stripeTransferId: transfer.id },
            include: {
                booking: {
                    include: {
                        therapist: true,
                        customer: true,
                    },
                },
            },
        });

        if (payment) {
            console.error(`Transfer failed for payment ${payment.id}`);
            // Keep payment in escrowed state for manual resolution
        }

    } catch (error) {
        console.error("Error handling transfer failure:", error);
    }

}

/**
 * Handle Transfer created - With recovery logic
 * This webhook serves two purposes:
 * 1. Confirmation that transfer succeeded (normal case)
 * 2. Recovery mechanism if database update failed (edge case)
 */
const handleTransferCreatedWithRecovery = async (transfer) => {
    try {
        const paymentId = transfer.metadata?.paymentId;

        if (!paymentId) {
            console.log(`No payment metadata found for transfer: ${transfer.id}`);
            return;
        }

        const payment = await prisma.payment.findUnique({
            where: { id: paymentId },
            include: {
                booking: {
                    include: {
                        therapist: true,
                        customer: true,
                    }
                }
            }
        });

        if (!payment) {
            console.error(`Payment not found: ${paymentId}`);
            return;
        }
        // RECOVERY CASE: Transfer succeeded but DB wasn't updated.
        // Skip if already processed (released, partially_released, or has transfer ID).
        if (payment.status === "escrowed" && !payment.stripeTransferId) {
            // Skip admin-initiated transfers — the admin service handles its own DB updates.
            // Without this, the webhook races the admin's DB write and overwrites partially_released → released.
            if (transfer.metadata?.releasedByAdmin) {
                console.log(`Payment ${payment.id} transfer was admin-initiated, skipping webhook recovery`);
                return;
            }

            if (transfer.metadata?.isPerSession === "true") {
                console.log(`Payment ${payment.id} transfer is per-session payout, skipping webhook recovery (handled by releaseSessionPayout)`);
                return;
            }

            // Customer refund transfers (finalize, missed visit, pending-refund claim)
            // are customer-destined, not therapist-destined. They should never flip
            // the payment to "released" — only therapist payouts do that.
            if (transfer.metadata?.type === "customer_refund") {
                console.log(`Payment ${payment.id} transfer is customer refund, skipping webhook recovery (handled by refund flow)`);
                return;
            }

            try {
                // Verify transfer is valid, not reversed, and not failed
                const verifiedTransfer = await stripe.transfers.retrieve(transfer.id);

                if (verifiedTransfer.reversed) {
                    console.log(`Transfer was reversed, not updating payment`);
                    return;
                }

                if (!verifiedTransfer.amount || verifiedTransfer.amount <= 0) {
                    console.log(`Transfer has invalid amount (${verifiedTransfer.amount}), skipping recovery`);
                    return;
                }

                // Update payment to released state (only for non-admin, non-per-session recovery)
                await prisma.payment.update({
                    where: { id: payment.id },
                    data: {
                        status: "released",
                        stripeTransferId: transfer.id,
                        releasedAt: new Date(),
                    }
                });

                console.log(`Payment ${payment.id} recovered and marked as released`);
            } catch (recoveryError) {
                console.error(`Recovery Failed: ${recoveryError.message}`);
                console.error(`MANUAL INTERVENTION REQUIRED`);

                // TODO: CRITICAL -Alert admin immediately
                // TODO: Create support ticket
            }
            return;
        }

        // Skip per-session transfers when payment is already partially_released —
        // releaseSessionPayout handles the status transitions.
        if (payment.status === "partially_released" && transfer.metadata?.isPerSession === "true") {
            return;
        }

        // UNEXPECTED STATE: Payment as different status
        if (payment.status !== "escrowed" && payment.status !== "released") {
            console.log(`Unexpected payment status: ${payment.status}`);
            console.log(`Payment ID: ${payment.id}`);
            console.log(`Transfer ID: ${transfer.id}`);
            console.log(`Manual review may be needed}`);
        }

    } catch (error) {
        console.error(`Error handling transfer.created:`, error.message);
    }
}

/**Connected account handlers */
const handleAccountUpdated = async (account, accountId) => {
    try {
        const stripeAccountId = accountId || account.id;

        // Try therapist first (most common case)
        const therapist = await prisma.therapistProfile.findUnique({
            where: { stripeAccountId },
        });

        if (therapist) {
            return handleTherapistAccountUpdated(account, therapist);
        }

        // Try customer (for refund payout accounts)
        const customer = await prisma.customerProfile.findUnique({
            where: { stripeAccountId },
        });

        if (customer) {
            return handleCustomerAccountUpdated(account, customer);
        }

        console.log(`No therapist or customer found for Stripe account: ${stripeAccountId}`);
    } catch (error) {
        console.error(`Error handling account.updated:`, error.message);
    }
}

const handleTherapistAccountUpdated = async (account, therapist) => {
    const isOnboardingComplete =
        account.details_submitted === true &&
        account.charges_enabled === true;

    if (isOnboardingComplete && !therapist.stripeOnboardingComplete) {
        await withAdminAccess(async (db) => {
            await db.therapistProfile.update({
                where: { stripeAccountId: account.id },
                data: { stripeOnboardingComplete: true },
            });
        });
        logger.info(`Stripe onboarding completed for therapist: ${therapist.fullName}`);
        return;
    }

    if (!isOnboardingComplete && therapist.stripeOnboardingComplete) {
        await withAdminAccess(async (db) => {
            await db.therapistProfile.update({
                where: { stripeAccountId: account.id },
                data: { stripeOnboardingComplete: false },
            });
        });
        logger.info(`Stripe onboarding status reverted for therapist: ${therapist.fullName}`);
    }

    // Proactively email the therapist when Stripe imposes new requirements
    // so they act before capabilities are restricted. Covers all three stages:
    //   past_due    → account already restricted, urgent
    //   currently_due → deadline approaching, warning
    //   future_requirements → upcoming, informational
    const req = account.requirements ?? {};
    const futureReq = account.future_requirements ?? {};
    const pastDueCount = req.past_due?.length ?? 0;
    const currentlyDueCount = req.currently_due?.length ?? 0;
    const futureDueCount =
        (req.eventually_due?.length ?? 0) +
        (futureReq.currently_due?.length ?? 0) +
        (futureReq.eventually_due?.length ?? 0);

    const shouldAlert = pastDueCount > 0 || currentlyDueCount > 0 || futureDueCount > 0;

    if (shouldAlert) {
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
                logger.error('[Webhook] Failed to send Stripe requirements alert email', {
                    therapistId: therapist.id,
                    error: err.message,
                });
            });
        }
    }
}

const handleCustomerAccountUpdated = async (account, customer) => {
    // Customer Connect accounts only need transfers capability (no charges)
    const isOnboardingComplete =
        account.details_submitted === true &&
        account.payouts_enabled === true;

    if (isOnboardingComplete && !customer.stripeOnboardingComplete) {
        await withAdminAccess(async (db) => {
            await db.customerProfile.update({
                where: { stripeAccountId: account.id },
                data: { stripeOnboardingComplete: true },
            });
        });

        logger.info(`Customer Connect onboarding completed: ${customer.fullName} (${customer.id})`);

        try {
            const results = await paymentService.processPendingRefundsForCustomer(customer.id);
            if (results.length > 0) {
                logger.info(`[Webhook] Auto-transferred ${results.filter(r => r.status === "transferred").length} pending refunds for customer ${customer.id}`);
            }
        } catch (err) {
            logger.error(`[Webhook] Failed to auto-transfer pending refunds for customer ${customer.id}`, {
                error: err.message,
            });
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
        logger.info(`Customer Connect onboarding status reverted: ${customer.fullName}`);
    }

    // Proactive email when Stripe imposes new requirements on the customer's
    // payout account — covers all three stages including volume-gated eventually_due
    // requirements that don't yet affect payouts_enabled.
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
                logger.error('[Webhook] Failed to send customer Stripe requirements alert email', {
                    customerId: customer.id,
                    error: err.message,
                });
            });
        }
    }
}

const handleExternalAccountCreated = async (externalAccount, accountId) => {
    try {
        const therapist = await prisma.therapistProfile.findUnique({
            where: { stripeAccountId: accountId },
        });

        if (therapist) {
            console.log(`External account added for therapist: ${therapist.fullName}`);
            // TODO: Send confirmation notification
        }
    } catch (error) {
        console.error(`Error: ${error.message}`);
    }
}

const handleExternalAccountDeleted = async (externalAccount, accountId) => {
    try {
        const therapist = await prisma.therapistProfile.findUnique({
            where: { stripeAccountId: accountId },
        });

        if (therapist) {
            console.log(`External account removed for therapist: ${therapist.fullName}`);
            console.log(`Therapist ${therapist.fullName} cannot receive payouts until they add a bank account!`);
            // TODO: Send urgent notification to therapist
        }
    } catch (error) {
        console.error(`Error: ${error.message}`);
    }
}

const handlePayoutPaid = async (payout, accountId) => {
    try {
        console.log(`Payout delivered: ${accountId}`);
        // Informational - payment already "released"

        const therapist = await prisma.therapistProfile.findUnique({
            where: { stripeAccountId: accountId },
        });

        if (therapist) {
            console.log(`Payout of $${payout.amount / 100} delivered to ${therapist.fullName}`);
        }
    } catch (error) {
        console.error(`Error:`, error.message);
    }
}

const handlePayoutFailed = async (payout, accountId) => {
    try {
        console.log(`Payout failed: ${accountId}`);
        console.log(`Reason: ${payout.failure_message}`);

        const therapist = await prisma.therapistProfile.findUnique({
            where: { stripeAccountId: accountId },
            include: { user: { select: { email: true } } },
        });

        if (therapist) {
            console.log(`Payout failed for therapist: ${therapist.fullName}`);

            // Notify therapist about failed payout (email)
            sendPayoutFailed({
                therapist,
                amount: payout.amount / 100,
                reason: payout.failure_message,
            }).catch(() => { });

            // NOTE: Payment status stays "released" - money is still in Stripe balance
            // Stripe will retry the payout automatically
        }
    } catch (error) {
        console.error(`Error handling payout failure:`, error.message);
    }
}

export { handleStripeWebhook };