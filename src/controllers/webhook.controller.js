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
            // (Payment Flow)
            case "payment_intent.succeeded":
                await handlePaymentIntentSucceeded(event.data.object);
                break;

            case "payment_intent.payment_failed":
                await handlePaymentIntentFailed(event.data.object);
                break;

            case "payment_intent.canceled":
                await handlePaymentIntentCanceled(event.data.object);
                break;

            // (Transfers / Payouts)
            case "transfer.reversed":
                await handleTransferReversed(event.data.object);
                break;

            case "payout.failed":
                await handleConnectedPayoutFailed(
                    event.data.object,
                    event.account
                );
                break;

            // (Connected Accounts)

            case "account.updated":
                await handleAccountUpdated(
                    event.data.object,
                    event.account);
                break;

            case "account.external_account.created":
                await handleExternalAccountCreated(
                    event.data.object,
                    event.account
                );
                break;

            case "account.external_account.deleted":
                await handleExternalAccountDeleted(
                    event.data.object,
                    event.account
                );
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
    await prisma.therapistProfile.findUnique({
        where: { stripeAccountId: accountId }
    });
}

const handleConnectedPayoutFailed = async (payout, accountId) => {
    await prisma.therapistProfile.findUnique({
        where: { stripeAccountId: accountId },
    });
}

export { handleStripeWebhook };