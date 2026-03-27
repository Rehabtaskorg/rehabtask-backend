import { stripe, stripeConfig } from "../config/stripe.js";
import * as paymentService from "../services/payment.service.js";
import * as subscriptionService from "../services/subscription.service.js";
import { prisma, withAdminAccess } from "../config/prisma.js";
import { sendPaymentFailed, sendPayoutFailed } from "../services/email.service.js";
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

        // Only affect the booking if THIS intent is still the active payment.
        // When a customer retries, the stale intent gets replaced via the reuse
        // pattern in createPaymentIntent — the booking's current payment record
        // now points to a NEW stripePaymentIntentId. A late-arriving webhook for
        // the old intent must not cancel the booking.
        const isActivePayment = payment.booking.payment?.id === payment.id;

        await prisma.$transaction(async (tx) => {
            await tx.payment.update({
                where: { id: payment.id },
                data: { status: "failed" },
            });

            if (isActivePayment) {
                await tx.booking.update({
                    where: { id: payment.bookingId },
                    data: { status: "cancelled" },
                });
            }
        });

        if (isActivePayment) {
            const failedBooking = await prisma.booking.findUnique({
                where: { id: payment.bookingId },
                include: {
                    customer: { include: { user: { select: { email: true } } } },
                },
            });

            if (failedBooking) {
                sendPaymentFailed({
                    customer: failedBooking.customer,
                    booking: failedBooking,
                    reason: paymentIntent.last_payment_error?.message,
                }).catch(() => { });
            }

            logSystemEvent({
                action: "payment.failed",
                entityType: "payment",
                entityId: payment.id,
                changes: {
                    bookingId: payment.bookingId,
                    reason: paymentIntent.last_payment_error?.message || "Payment failed",
                    stripePaymentIntentId: paymentIntent.id,
                },
            });
        } else {
            logger.info("[Webhook] Stale PaymentIntent failed — booking not affected", {
                paymentIntentId: paymentIntent.id,
                bookingId: payment.bookingId,
            });
        }

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
            include: { booking: { include: { payment: true } } },
        });

        if (payment && payment.status === "intent_created") {
            // Only cancel the booking if THIS payment is still the active one for the booking.
            // If the payment was replaced by a new PaymentIntent (stale intent reuse pattern),
            // the booking's current payment will have a DIFFERENT stripePaymentIntentId.
            const isActivePayment = payment.booking.payment?.id === payment.id;

            await prisma.$transaction(async (tx) => {
                await tx.payment.update({
                    where: { id: payment.id },
                    data: { status: "failed" },
                });

                // Only cancel the booking if this was the active payment, not a stale one
                if (isActivePayment) {
                    await tx.booking.update({
                        where: { id: payment.bookingId },
                        data: { status: "cancelled" },
                    });
                }
            });

            if (!isActivePayment) {
                logger.info("[Webhook] Stale PaymentIntent canceled — booking not affected", {
                    paymentIntentId: paymentIntent.id,
                    bookingId: payment.bookingId,
                });
            }
        }
    } catch (error) {
        console.error(`Error handling payment cancellation:`, error.message);
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
const handleTransferFailed = async (transfer) => {
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

                // Update payment to released state (only for non-admin recovery)
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

        // Find therapist with this Stripe account
        const therapist = await prisma.therapistProfile.findUnique({
            where: { stripeAccountId },
        });

        if (!therapist) {
            console.log(`No therapist found for Stripe account: ${stripeAccountId}`);
            return;
        }

        // Check if onboarding is complete
        const isOnboardingComplete =
            account.details_submitted === true &&
            account.charges_enabled === true;

        // Only update if status changed
        if (isOnboardingComplete && !therapist.stripeOnboardingComplete) {
            await withAdminAccess(async (db) => {
                await db.therapistProfile.update({
                    where: { stripeAccountId },
                    data: {
                        stripeOnboardingComplete: true,
                    },
                });
            });

            console.log(`Stripe onboarding completed for therapist: ${therapist.fullName}`);

            // TODO: Send notification to therapist
            // TODO: If this was their last onboarding step, mark overall onboarding complete
        } else if (!isOnboardingComplete && therapist.stripeOnboardingComplete) {
            // Account was complete but now isn't (rare, but possible)
            await withAdminAccess(async (db) => {
                await db.therapistProfile.update({
                    where: { stripeAccountId },
                    data: {
                        stripeOnboardingComplete: false
                    },
                });
            });

            console.log(`Stripe onboarding status reverted for therapist: ${therapist.fullName}`);
        }
    } catch (error) {
        console.error(`Error handling account.updated:`, error.message);
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