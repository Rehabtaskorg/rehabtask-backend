import { prisma, withAdminAccess } from "../config/prisma.js";
import { stripe, stripeConfig } from "../config/stripe.js";
import { sendPaymentConfirmation, sendPayoutConfirmation } from "./email.service.js";
import { logger } from "../config/logger.js";

/**
 * Create payment intent and escrow funds
 */
const createPaymentIntent = async (bookingId, userId) => {
    const booking = await prisma.booking.findUnique({
        where: { id: bookingId },
        include: {
            customer: { include: { user: true } },
            therapist: { include: { user: true } },
            offer: true,
        },
    });

    if (!booking) {
        throw new Error("Booking not found");
    }

    if (booking.customer.userId !== userId) {
        throw new Error("Unauthorized");
    }

    if (booking.status !== "pending") {
        throw new Error("Booking must be in pending status");
    }

    const amount = parseFloat(booking.rate);
    const platformFee = (amount * stripeConfig.platformFeePercentage) / 100;
    const therapistPayout = amount - platformFee;

    // Check if payment already exists for this booking
    const existingPayment = await prisma.payment.findUnique({
        where: { bookingId: booking.id }
    });

    if (existingPayment) {
        // return existing payment intent
        const paymentIntent = await stripe.paymentIntents.retrieve(
            existingPayment.stripePaymentIntentId
        );

        return {
            clientSecret: paymentIntent.client_secret,
            payment: existingPayment
        };
    }

    // Create stripe customer if not exists
    let stripeCustomerId = booking.customer.stripeCustomerId;

    if (!stripeCustomerId) {
        // Check if customer already exists in Stripe by email
        const existingCustomers = await stripe.customers.list({
            email: booking.customer.user.email,
            limit: 1
        });

        if (existingCustomers.data.length > 0) {
            stripeCustomerId = existingCustomers.data[0].id;
        } else {
            const customer = await stripe.customers.create({
                email: booking.customer.user.email,
                name: booking.customer.fullName,
                metadata: { customerId: booking.customer.id },
            });

            stripeCustomerId = customer.id;
        }

        await prisma.customerProfile.update({
            where: { id: booking.customer.id },
            data: { stripeCustomerId },
        });
    }

    // Create payment intent
    const paymentIntent = await stripe.paymentIntents.create({
        amount: Math.round(amount * 100),
        currency: "usd",
        customer: stripeCustomerId,
        payment_method_types: ["card"],
        payment_method_options: {
            card: {
                request_three_d_secure: "automatic",
            },
        },
        setup_future_usage: "off_session",
        metadata: {
            bookingId: booking.id,
            customerId: booking.customer.id,
            therapistId: booking.therapist.id,
            platformFee: platformFee.toFixed(2),
            therapistPayout: therapistPayout.toFixed(2),
        },
        description: `Therapy session with ${booking.therapist.fullName}`,
        capture_method: 'automatic',
    });

    // Create payment record
    const payment = await prisma.payment.create({
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

    await prisma.payment.update({
        where: { id: payment.id },
        data: {
            status: "escrowed",
            escrowedAt: new Date(),
        },
    });

    await prisma.booking.update({
        where: { id: payment.bookingId },
        data: { status: "confirmed" },
    });

    await prisma.session.create({
        data: {
            bookingId: payment.bookingId,
            scheduledDate: payment.booking.scheduledDate,
            status: "scheduled",
        },
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
                    therapist: true,
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
        });
    } catch (stripeError) {
        console.error(`Transfer creation failed:`, stripeError.message);
        throw new Error(`Failed to transfer payment: ${stripeError.message}`)
    }

    try {
        const updatedPayment = await prisma.payment.update({
            where: { id: payment.id },
            data: {
                status: "released",
                stripeTransferId: transfer.id,
                releasedAt: new Date(),
            },
        });

        // Send payout confirmation email to therapist
        const therapistWithEmail = await prisma.therapistProfile.findUnique({
            where: { id: session.booking.therapist.id },
            include: { user: { select: { email: true } } },
        });

        if (therapistWithEmail) {
            sendPayoutConfirmation({
                therapist: therapistWithEmail,
                payment: updatedPayment,
                booking: session.booking,
            }).catch(() => { });
        }

        return updatedPayment;
    } catch (dbError) {
        console.error(`Critical: Transfer ${transfer.id} succeed but DB update failed`);
        throw new Error("Transfer succeeded but database update failed");
    }
}

/**
 * Process refund
 */
const processRefund = async (bookingId, reason) => {
    const booking = await prisma.booking.findUnique({
        where: { id: bookingId },
        include: {
            payment: true,
            session: true,
        },
    });

    if (!booking || !booking.payment) {
        throw new Error("Booking or payment not found");
    }

    const payment = booking.payment;

    if (!["escrowed", "intent_created"].includes(payment.status)) {
        throw new Error("Payment cannot be refunded");
    }

    const refund = await stripe.refunds.create({
        payment_intent: payment.stripePaymentIntentId,
        reason: "requested_by_customer",
        metadata: {
            bookingId: booking.id,
            refundReason: reason,
        },
    });

    await prisma.payment.update({
        where: { id: payment.id },
        data: {
            status: "refunded",
            refundedAt: new Date(),
        },
    });

    await prisma.booking.update({
        where: { id: bookingId },
        data: { status: "cancelled" }
    });

    if (booking.session) {
        await prisma.session.update({
            where: { id: booking.session.id },
            data: {
                status: "cancelled",
                cancellationReason: reason,
            },
        });
    }

    return refund;
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

export {
    createPaymentIntent,
    handlePaymentSuccess,
    releasePayment,
    processRefund,
    getCustomerPaymentHistory,
    getTherapistPayoutHistory,
    createConnectAccountLink,
    getConnectAccountStatus,
    createDashboardLink
}