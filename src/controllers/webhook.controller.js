import { stripe, stripeConfig } from "../config/stripe.js";
import * as paymentService from "../services/payment.service.js";
import { prisma } from "../config/prisma.js";

/**
 * Handle Stripe webhooks
 */
const handleStripeWebhook = async (req, res) => {
    const sig = req.headers["stripe-signature"];
    let event;

    try {
        event = stripe.webhooks.constructEvent(req.body, sig, stripeConfig.webhookSecret);
    } catch (error) {
        console.error("Webhook signature verification failed:", error.message);
        return res.status(400).send(`Webhook Error: ${error.message}`);
    }

    console.log("Event type:", event.type);


    try {
        switch (event.type) {
            case "payment_intent.succeeded":
                await handlePaymentIntentSucceeded(event.data.object);
                break;

            case "payment_intent.payment_failed":
                await handlePaymentIntentFailed(event.data.object);
                break;

            case "transfer.created":
                console.log("Transfer created:", event.data.object.id);
                break;

            // case "transfer.failed":
            //     await handleTransferFailed(event.data.object);
            //     break;

            case "account.updated":
                console.log("Account updated:", event.data.object.id);
                break;

            default:
                console.log(`Unhandled event type:${event.type}`);
        }

        res.json({ received: true });
    } catch (error) {
        console.error("Error processing webhook:", error);
        res.status(500).json({ error: "Webhook processing failed" });
    }

}

/**
 * Handle successful payment intent
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
    console.log("Payment intent failed:", paymentIntent.id);

    try {
        const payment = await prisma.payment.findUnique({
            where: { stripePaymentIntentId: paymentIntent.id },
        });

        if (!payment) {
            await prisma.payment.update({
                where: { id: payment.id },
                data: { status: "failed" },
            });

            await prisma.booking.update({
                where: { id: payment.bookingId },
                data: { status: "cancelled" },
            });

            console.log("Payment and booking marked as failed/cancelled")
        }

    } catch (error) {
        console.error("Error handing payment failure:", error);
        throw error;
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
        });

        if (payment) {
            console.error(`Transfer failed for payment ${payment.id}`);
            // Keep payment in escrowed state for manual resolution
        }

    } catch (error) {
        console.error("Error handling transfer failure:", error);
    }

}

export { handleStripeWebhook };