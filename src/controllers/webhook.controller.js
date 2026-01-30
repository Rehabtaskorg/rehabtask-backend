import { stripe, stripeConfig } from "../config/stripe.js";
import * as paymentService from "../services/payment.service.js";
import { prisma } from "../config/prisma.js";

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

            default:
                console.log(`Unhandled event type:${event.type}`);
        }

        res.json({ received: true, event: event.type });
    } catch (error) {
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
            include: { booking: true }
        });

        if (payment) {
            await prisma.payment.update({
                where: { id: payment.id },
                data: { status: "failed" },
            });

            await prisma.booking.update({
                where: { id: payment.bookingId },
                data: { status: "cancelled" },
            });

            // TODO: Send notification to customer about failed payment
            console.log("Payment and booking marked as failed/cancelled")
        } else {
            console.log(`No payment record found for payment intent: ${paymentIntent.id}`);
        }

    } catch (error) {
        console.error("Error handing payment failure:", error);
        throw error;
    }

}

/**
 * Handle canceled payment intent
 */
const handlePaymentIntentCanceled = async (paymentIntent) => {
    try {
        const payment = await prisma.payment.findUnique({
            where: { stripePaymentIntentId: paymentIntent.id }
        });

        if (payment && payment.status === "intent_created") {
            await prisma.payment.update({
                where: { id: payment.id },
                data: { status: "failed" },
            });

            await prisma.booking.update({
                where: { id: payment.bookingId },
                data: { status: "cancelled" },
            });
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
        // NORMAL CASE: Payment already marked as released
        if (payment.status === "escrowed" && !payment.stripeTransferId) {
            try {
                // Verify transfer is valid and not reversed
                const verifiedTransfer = await stripe.transfers.retrieve(transfer.id);

                if (verifiedTransfer.reversed) {
                    console.log(`Transfer was reversed, not updating payment`);
                    return;
                }

                // Update payment to released state
                await prisma.payment.update({
                    where: { id: payment.id },
                    data: {
                        status: "released",
                        stripeTransferId: transfer.id,
                        releasedAt: new Date(),
                    }
                });

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
    await prisma.therapistProfile.findUnique({
        where: { stripeAccountId: accountId || account.id },
    });

    // Status inspection only
}

const handleExternalAccountCreated = async (externalAccount, accountId) => {
    await prisma.therapistProfile.findUnique({
        where: { stripeAccountId: accountId },
    });
}

const handleExternalAccountDeleted = async (externalAccount, accountId) => {
    try {
        const therapist = await prisma.therapistProfile.findUnique({
            where: { stripeAccountId: accountId }
        });
        if (therapist) {
            console.log(`Therapist ${therapist.fullName} cannot receive payouts!`);
        }
    } catch (error) {
        console.error(`Error: ${error.message}`);
    }
}

const handlePayoutPaid = async (payout, accountId) => {
    try {
        console.log(`Payout delivered: ${accountId}`);
        // Informational - payment already "released"
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
        });

        if (therapist) {
            console.log(`Payout failed for therapist: ${therapist.fullName}`);

            // TODO:
            // 1. Notify therapist about failed payout
            // 2. Request bank account verification
            // 3. Alert admin to investigate

            // NOTE: Payment status stays "released" - money is still in Stripe balance
            // Stripe will retry the payout automatically

        }
    } catch (error) {
        console.error(`Error handling payout failure:`, error.message);
    }
}

export { handleStripeWebhook };