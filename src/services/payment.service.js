import { prisma, withAdminAccess } from "../config/prisma.js";
import { stripe, stripeConfig } from "../config/stripe.js";
import { sendPaymentConfirmation, sendPayoutConfirmation, sendPaymentReleasedToCustomer } from "./email.service.js";
import { logger } from "../config/logger.js";
import { getCommissionRateByTier } from "./commission.service.js";

/**
 * Get or create a Stripe customer for a given user.
 * Reusable across payment intent creation and saved payment methods.
 */
const getOrCreateStripeCustomer = async (userId) => {
    const customerProfile = await prisma.customerProfile.findUnique({
        where: { userId },
        include: { user: true },
    });

    if (!customerProfile) {
        throw new Error("Customer profile not found");
    }

    if (customerProfile.stripeCustomerId) {
        return { stripeCustomerId: customerProfile.stripeCustomerId, customerProfile };
    }

    // Check if customer already exists in Stripe by email
    const existingCustomers = await stripe.customers.list({
        email: customerProfile.user.email,
        limit: 1,
    });

    let stripeCustomerId;
    if (existingCustomers.data.length > 0) {
        stripeCustomerId = existingCustomers.data[0].id;
    } else {
        const customer = await stripe.customers.create({
            email: customerProfile.user.email,
            name: customerProfile.fullName,
            metadata: { customerId: customerProfile.id },
        });
        stripeCustomerId = customer.id;
    }

    await prisma.customerProfile.update({
        where: { id: customerProfile.id },
        data: { stripeCustomerId },
    });

    return { stripeCustomerId, customerProfile };
};

/**
 * Create payment intent and escrow funds.
 * If paymentMethodId is provided, charges the saved card immediately.
 */
const createPaymentIntent = async (bookingId, userId, paymentMethodId = null) => {
    const booking = await prisma.booking.findUnique({
        where: { id: bookingId },
        include: {
            customer: { include: { user: true } },
            therapist: { select: { id: true, userId: true, fullName: true, stripeAccountId: true, planTier: true, user: true } },
            offer: true,
        },
    });

    if (!booking) {
        throw new Error("Booking not found");
    }

    if (booking.customer.userId !== userId) {
        throw new Error("Unauthorized");
    }

    if (!["pending", "accepted"].includes(booking.status)) {
        throw new Error("Booking must be in pending or accepted status");
    }

    const amount = parseFloat(booking.rate);

    // Resolve commission rate from therapist's subscription tier.
    let feePercent;
    try {
        feePercent = await getCommissionRateByTier(booking.therapist.planTier ?? "basic");
    } catch (err) {
        logger.error("[PaymentService] Commission rate lookup failed, using env fallback", {
            therapistId: booking.therapist.id,
            planTier: booking.therapist.planTier,
            error: err.message,
        });
        feePercent = stripeConfig.platformFeePercentage / 100;
    }

    const platformFee = amount * feePercent;
    const therapistPayout = amount - platformFee;

    // Check if payment already exists for this booking
    const existingPayment = await prisma.payment.findUnique({
        where: { bookingId: booking.id }
    });

    let stalePaymentToReuse = null;

    if (existingPayment) {
        // Retrieve the Stripe PaymentIntent to check its current status
        const paymentIntent = await stripe.paymentIntents.retrieve(
            existingPayment.stripePaymentIntentId
        );

        switch (paymentIntent.status) {
            case "succeeded":
                return { status: "succeeded", payment: existingPayment };

            case "processing":
                return { status: "processing", payment: existingPayment };

            case "requires_action":
                return { status: "requires_action", clientSecret: paymentIntent.client_secret, payment: existingPayment };

            case "canceled":
            case "requires_payment_method":
                // Intent is expired, failed, or canceled — reuse the record with a new intent
                if (paymentIntent.status !== "canceled") {
                    await stripe.paymentIntents.cancel(paymentIntent.id).catch((err) => {
                        logger.warn("[PaymentService] Failed to cancel stale intent", { intentId: paymentIntent.id, error: err.message });
                    });
                }
                stalePaymentToReuse = existingPayment;
                break;

            default:
                // e.g. requires_confirmation — return clientSecret as normal
                return { clientSecret: paymentIntent.client_secret, payment: existingPayment };
        }
    }

    // Get or create Stripe customer
    const { stripeCustomerId } = await getOrCreateStripeCustomer(userId);

    const intentParams = {
        amount: Math.round(amount * 100),
        currency: "usd",
        customer: stripeCustomerId,
        payment_method_types: ["card"],
        payment_method_options: {
            card: {
                request_three_d_secure: "automatic",
            },
        },
        metadata: {
            bookingId: booking.id,
            customerId: booking.customer.id,
            therapistId: booking.therapist.id,
            platformFee: platformFee.toFixed(2),
            therapistPayout: therapistPayout.toFixed(2),
        },
        description: `Therapy session with ${booking.therapist.fullName}`,
        capture_method: 'automatic',
    };

    // If paying with a saved card, confirm immediately
    if (paymentMethodId) {
        intentParams.payment_method = paymentMethodId;
        intentParams.confirm = true;
        intentParams.return_url = `${process.env.FRONTEND_URL}/customer/bookings/${bookingId}`;
    } else {
        // New card flow: save the card for future use
        intentParams.setup_future_usage = "off_session";
    }

    // Create payment intent
    const paymentIntent = await stripe.paymentIntents.create(intentParams);

    // Create or update payment record
    let payment;
    if (stalePaymentToReuse) {
        // Reuse the existing record — preserves audit trail and avoids unique constraint issues
        payment = await prisma.payment.update({
            where: { id: stalePaymentToReuse.id },
            data: {
                stripePaymentIntentId: paymentIntent.id,
                amount,
                platformFee,
                therapistPayout,
                status: "intent_created",
            },
        });
    } else {
        try {
            payment = await prisma.payment.create({
                data: {
                    bookingId: booking.id,
                    customerId: booking.customer.id,
                    therapistId: booking.therapist.id,
                    stripePaymentIntentId: paymentIntent.id,
                    amount,
                    platformFee,
                    therapistPayout,
                    status: "intent_created"
                },
            });
        } catch (err) {
            // Unique constraint violation on bookingId — a concurrent request already created the payment
            if (err.code === "P2002") {
                // Cancel the Stripe intent we just created since it's now orphaned
                await stripe.paymentIntents.cancel(paymentIntent.id).catch((cancelErr) => {
                    logger.warn("[PaymentService] Failed to cancel orphaned intent after P2002", { intentId: paymentIntent.id, error: cancelErr.message });
                });
                // Return the payment that the other request created
                const existingPayment = await prisma.payment.findUnique({ where: { bookingId: booking.id } });
                if (existingPayment) {
                    const existingIntent = await stripe.paymentIntents.retrieve(existingPayment.stripePaymentIntentId);
                    return { clientSecret: existingIntent.client_secret, payment: existingPayment };
                }
                throw new Error("Payment creation conflict — please retry");
            }
            throw err;
        }
    }

    // If confirmed immediately and succeeded, the webhook will handle status transitions
    if (paymentIntent.status === "succeeded") {
        return { status: "succeeded", payment };
    }

    // If 3D Secure is required, return clientSecret for frontend to handle
    if (paymentIntent.status === "requires_action") {
        return { status: "requires_action", clientSecret: paymentIntent.client_secret, payment };
    }

    return {
        clientSecret: paymentIntent.client_secret,
        payment
    };
}

/**
 * Handle successful payment (webhook handler)
 */
const handlePaymentSuccess = async (paymentIntentId) => {
    const payment = await prisma.payment.findUnique({
        where: { stripePaymentIntentId: paymentIntentId },
        include: {
            booking: true,
        },
    });

    if (!payment) {
        throw new Error("Payment not found");
    }

    // Idempotency: if already processed, return early to prevent duplicate side effects
    if (payment.status === "escrowed") {
        return payment;
    }

    await prisma.$transaction(async (tx) => {
        await tx.payment.update({
            where: { id: payment.id },
            data: {
                status: "escrowed",
                escrowedAt: new Date(),
            },
        });

        await tx.booking.update({
            where: { id: payment.bookingId },
            data: { status: "confirmed" },
        });

        // Upsert session to avoid duplicates from webhook retries
        await tx.session.upsert({
            where: { bookingId: payment.bookingId },
            update: {},
            create: {
                bookingId: payment.bookingId,
                scheduledDate: payment.booking.scheduledDate,
                status: "scheduled",
            },
        });
    });

    // Send payment confirmation email to customer
    const bookingWithDetails = await prisma.booking.findUnique({
        where: { id: payment.bookingId },
        include: {
            customer: { include: { user: { select: { email: true } } } },
            therapist: { select: { fullName: true } },
        },
    });

    if (bookingWithDetails) {
        sendPaymentConfirmation({
            customer: bookingWithDetails.customer,
            booking: bookingWithDetails,
            payment,
        }).catch(() => { });
    }

    return payment;
}

/**
 * Release payment to therapist after session confirmation
 */
const releasePayment = async (sessionId) => {
    const session = await prisma.session.findUnique({
        where: { id: sessionId },
        include: {
            booking: {
                include: {
                    payment: true,
                    therapist: { include: { user: { select: { email: true } } } },
                    customer: { include: { user: { select: { email: true } } } },
                },
            },
        },
    });

    if (!session) {
        throw new Error("Session not found");
    }

    if (session.status !== "confirmed_by_customer") {
        throw new Error("Session must be confirmed by customer before payout");
    }

    const payment = session.booking.payment;

    // Idempotent: if already released, return as-is (safe retry after partial failure)
    if (payment && payment.status === "released") {
        return payment;
    }

    if (!payment || payment.status !== "escrowed") {
        throw new Error("Payment not in escrowed state");
    }

    const therapist = session.booking.therapist;

    if (!therapist.stripeAccountId) {
        throw new Error("Therapist has not connected Stripe account");
    }

    let transfer;
    try {
        transfer = await stripe.transfers.create({
            amount: Math.round(parseFloat(payment.therapistPayout) * 100),
            currency: "usd",
            destination: therapist.stripeAccountId,
            metadata: {
                paymentId: payment.id,
                sessionId: session.id,
                bookingId: session.bookingId,
            },
            description: `Payout for session ${session.id}`,
        }, {
            idempotencyKey: `release-${payment.id}`,
        });
    } catch (stripeError) {
        logger.error(`Transfer creation failed:`, stripeError.message);
        throw new Error(`Failed to transfer payment: ${stripeError.message}`)
    }

    // Immediately persist the transfer ID so we never lose track of it.
    // This prevents double-pay: if the full status update below fails,
    // processRefund will still see stripeTransferId and block the refund.
    try {
        await prisma.payment.update({
            where: { id: payment.id },
            data: { stripeTransferId: transfer.id },
        });
    } catch (saveTransferIdError) {
        // CRITICAL: Transfer was created in Stripe but we cannot record it.
        // Log everything needed for manual reconciliation.
        logger.error(`CRITICAL: Stripe transfer ${transfer.id} succeeded but failed to save stripeTransferId to payment ${payment.id}. Manual reconciliation required.`, {
            transferId: transfer.id,
            paymentId: payment.id,
            sessionId: session.id,
            bookingId: session.bookingId,
            error: saveTransferIdError.message,
        });
        throw new Error("Transfer succeeded but database update failed. Support has been notified.");
    }

    try {
        const updatedPayment = await prisma.payment.update({
            where: { id: payment.id },
            data: {
                status: "released",
                releasedAt: new Date(),
            },
        });

        // Send payout confirmation email to therapist
        sendPayoutConfirmation({
            therapist: session.booking.therapist,
            payment: updatedPayment,
            booking: session.booking,
        }).catch(() => { });

        // Notify customer that their payment has been released
        sendPaymentReleasedToCustomer({
            customer: session.booking.customer,
            therapist: session.booking.therapist,
            payment: updatedPayment,
            booking: session.booking,
        }).catch(() => { });

        return updatedPayment;
    } catch (dbError) {
        logger.error(`CRITICAL: Transfer ${transfer.id} succeeded but status update to 'released' failed for payment ${payment.id}. stripeTransferId was saved. Manual status update required.`, {
            transferId: transfer.id,
            paymentId: payment.id,
            error: dbError.message,
        });
        throw new Error("Transfer succeeded but database update failed. Support has been notified.");
    }
}

/**
 * Process refund
 */
const processRefund = async (bookingId, userId, reason) => {
    const booking = await prisma.booking.findUnique({
        where: { id: bookingId },
        include: {
            payment: true,
            session: true,
            customer: { select: { userId: true } },
        },
    });

    if (!booking || !booking.payment) {
        throw new Error("Booking or payment not found");
    }

    // Ownership check: only the customer who owns this booking can request a refund
    if (booking.customer.userId !== userId) {
        throw new Error("Unauthorized: you can only refund your own bookings");
    }

    const payment = booking.payment;

    if (!["escrowed", "intent_created"].includes(payment.status)) {
        throw new Error("Payment cannot be refunded");
    }

    // Defense-in-depth: block refund if funds were already transferred to therapist.
    // Without this, customer gets full refund while therapist keeps the transfer — net loss.
    if (payment.stripeTransferId) {
        throw new Error(
            "Payment cannot be refunded because funds have already been transferred to the therapist. Please contact support."
        );
    }

    let refund = null;

    if (payment.status === "intent_created") {
        // Payment was never charged — cancel the PaymentIntent instead of refunding
        try {
            await stripe.paymentIntents.cancel(payment.stripePaymentIntentId, {
                cancellation_reason: "requested_by_customer",
            });
        } catch (cancelErr) {
            logger.warn("[PaymentService] Failed to cancel intent during refund", {
                intentId: payment.stripePaymentIntentId,
                error: cancelErr.message,
            });
        }
    } else {
        // Payment was charged (escrowed) — issue a Stripe refund
        refund = await stripe.refunds.create({
            payment_intent: payment.stripePaymentIntentId,
            reason: "requested_by_customer",
            metadata: {
                bookingId: booking.id,
                refundReason: reason,
            },
        });
    }

    await prisma.$transaction(async (tx) => {
        await tx.payment.update({
            where: { id: payment.id },
            data: payment.status === "intent_created"
                ? { status: "failed" }
                : { status: "refunded", refundedAt: new Date() },
        });

        await tx.booking.update({
            where: { id: bookingId },
            data: { status: "cancelled" },
        });

        if (booking.session) {
            await tx.session.update({
                where: { id: booking.session.id },
                data: {
                    status: "cancelled",
                    cancellationReason: reason,
                },
            });
        }
    });

    return { refund, paymentId: payment.id, amount: parseFloat(payment.amount) };
}

/**
 * Get customer payment history
 */
const getCustomerPaymentHistory = async (customerId) => {
    return prisma.payment.findMany({
        where: { customerId },
        include: {
            booking: {
                include: {
                    therapist: true,
                    offer: {
                        include: {
                            request: true,
                        },
                    },
                },
            },
        },
        orderBy: { createdAt: "desc" },
    });
};

/**
 * Get therapist earnings/payout history
 */
const getTherapistPayoutHistory = async (therapistId) => {
    const payments = await prisma.payment.findMany({
        where: {
            therapistId,
            status: { in: ["released", "escrowed"] },
        },
        include: {
            booking: {
                include: {
                    customer: true,
                    offer: {
                        include: {
                            request: true,
                        },
                    },
                },
            },
        },
        orderBy: { createdAt: "desc" },
    });

    const totalEarnings = payments
        .filter((p) => p.status === "released")
        .reduce((sum, p) => sum + parseFloat(p.therapistPayout), 0);

    const pendingEarnings = payments
        .filter((p) => p.status === "escrowed")
        .reduce((sum, p) => sum + parseFloat(p.therapistPayout), 0);

    return { payments, totalEarnings, pendingEarnings };
}

/**
 * Create Stripe Connect account link for therapist onboarding
 */
const createConnectAccountLink = async (therapistId, userId) => {
    const therapist = await prisma.therapistProfile.findUnique({
        where: { id: therapistId },
        include: { user: true },
    });

    if (!therapist) {
        throw new Error("Therapist not found");
    }

    if (therapist.userId !== userId) {
        throw new Error("Unauthorized");
    }

    let accountId = therapist.stripeAccountId;

    if (!accountId) {
        const account = await stripe.accounts.create({
            type: "express",
            email: therapist.user.email,
            metadata: {
                therapistId: therapist.id,
                userId: therapist.userId,
            },
        });

        accountId = account.id;

        await withAdminAccess(async (db) => {
            await db.therapistProfile.update({
                where: { id: therapistId },
                data: { stripeAccountId: account.id }
            });
        });
    }

    const accountLink = await stripe.accountLinks.create({
        account: accountId,
        refresh_url: `${process.env.FRONTEND_URL}/therapist/onboarding/stripe?stripe_refresh=true`,
        return_url: `${process.env.FRONTEND_URL}/therapist/onboarding/stripe?stripe_success=true`,
        type: "account_onboarding",
    });

    return {
        url: accountLink.url,
        accountId
    };
};

/**
 * Check Stripe Connect account status
 */
const getConnectAccountStatus = async (therapistId) => {
    const therapist = await prisma.therapistProfile.findUnique({
        where: { id: therapistId },
    });

    if (!therapist || !therapist.stripeAccountId) {
        return {
            connected: false,
            detailsSubmitted: false,
            chargesEnabled: false,
            payoutsEnabled: false,
        };
    }

    const account = await stripe.accounts.retrieve(therapist.stripeAccountId);

    return {
        connected: true,
        accountId: therapist.stripeAccountId,
        detailsSubmitted: account.details_submitted,
        chargesEnabled: account.charges_enabled,
        payoutsEnabled: account.payouts_enabled,
    };
};

/**
 * Create Stripe Express Dashboard login link
 */
const createDashboardLink = async (therapistId, userId) => {
    const therapist = await prisma.therapistProfile.findUnique({
        where: { id: therapistId },
    });

    if (!therapist) {
        throw new Error("Therapist not found");
    }

    if (therapist.userId !== userId) {
        throw new Error("Unauthorized");
    }

    if (!therapist.stripeAccountId) {
        throw new Error("No Stripe account connected");
    }

    // Create a login link for the Express Dashboard
    const loginLink = await stripe.accounts.createLoginLink(
        therapist.stripeAccountId
    );

    return {
        url: loginLink.url
    };
}

/**
 * List customer's saved payment methods from Stripe
 */
const getPaymentMethods = async (userId) => {
    const customerProfile = await prisma.customerProfile.findUnique({
        where: { userId },
    });

    if (!customerProfile?.stripeCustomerId) {
        return [];
    }

    const paymentMethods = await stripe.paymentMethods.list({
        customer: customerProfile.stripeCustomerId,
        type: "card",
    });

    // Get customer's default payment method
    const customer = await stripe.customers.retrieve(customerProfile.stripeCustomerId);
    const defaultPmId = customer.invoice_settings?.default_payment_method;

    // Deduplicate by card fingerprint — keep the default or most recent, detach extras
    const seen = new Map(); // fingerprint -> paymentMethod
    const duplicates = [];

    for (const pm of paymentMethods.data) {
        const fingerprint = pm.card.fingerprint;
        const existing = seen.get(fingerprint);

        if (!existing) {
            seen.set(fingerprint, pm);
        } else {
            // Keep the default one, or the newer one
            const existingIsDefault = existing.id === defaultPmId;
            const currentIsDefault = pm.id === defaultPmId;

            if (currentIsDefault || (!existingIsDefault && pm.created > existing.created)) {
                duplicates.push(existing.id);
                seen.set(fingerprint, pm);
            } else {
                duplicates.push(pm.id);
            }
        }
    }

    // Detach duplicates in background (don't block the response)
    if (duplicates.length > 0) {
        Promise.allSettled(
            duplicates.map((id) => stripe.paymentMethods.detach(id))
        ).catch(() => {});
    }

    const unique = Array.from(seen.values());
    return unique.map((pm) => ({
        id: pm.id,
        brand: pm.card.brand,
        last4: pm.card.last4,
        expMonth: pm.card.exp_month,
        expYear: pm.card.exp_year,
        isDefault: pm.id === defaultPmId,
    }));
};

/**
 * Create a Stripe SetupIntent for saving a card without charging
 */
const createSetupIntent = async (userId) => {
    const { stripeCustomerId } = await getOrCreateStripeCustomer(userId);

    const setupIntent = await stripe.setupIntents.create({
        customer: stripeCustomerId,
        payment_method_types: ["card"],
    });

    return { clientSecret: setupIntent.client_secret };
};

/**
 * Detach a saved payment method from the customer
 */
const removePaymentMethod = async (userId, paymentMethodId) => {
    const customerProfile = await prisma.customerProfile.findUnique({
        where: { userId },
    });

    if (!customerProfile?.stripeCustomerId) {
        throw new Error("No Stripe customer found");
    }

    // Verify the payment method belongs to this customer
    const pm = await stripe.paymentMethods.retrieve(paymentMethodId);
    if (pm.customer !== customerProfile.stripeCustomerId) {
        throw new Error("Payment method does not belong to this customer");
    }

    await stripe.paymentMethods.detach(paymentMethodId);
    return { success: true };
};

/**
 * Set a payment method as the customer's default
 */
const setDefaultPaymentMethod = async (userId, paymentMethodId) => {
    const customerProfile = await prisma.customerProfile.findUnique({
        where: { userId },
    });

    if (!customerProfile?.stripeCustomerId) {
        throw new Error("No Stripe customer found");
    }

    // Verify the payment method belongs to this customer
    const pm = await stripe.paymentMethods.retrieve(paymentMethodId);
    if (pm.customer !== customerProfile.stripeCustomerId) {
        throw new Error("Payment method does not belong to this customer");
    }

    await stripe.customers.update(customerProfile.stripeCustomerId, {
        invoice_settings: { default_payment_method: paymentMethodId },
    });

    return { success: true };
};

export {
    createPaymentIntent,
    handlePaymentSuccess,
    releasePayment,
    processRefund,
    getCustomerPaymentHistory,
    getTherapistPayoutHistory,
    createConnectAccountLink,
    getConnectAccountStatus,
    createDashboardLink,
    getOrCreateStripeCustomer,
    getPaymentMethods,
    createSetupIntent,
    removePaymentMethod,
    setDefaultPaymentMethod,
}