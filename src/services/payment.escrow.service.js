import { BOOKING_STATUS, SESSION_STATUS } from "../utils/constants.js";
import { prisma } from "../config/prisma.js";
import { stripe, stripeConfig } from "../config/stripe.js";
import { logger } from "../config/logger.js";
import { getCommissionRate } from "./commission.service.js";
import { logAction, logSystemEvent } from "./audit.service.js";
import { findOrCreateDirectConversation, createSystemMessage } from "./message.service.js";
import { resolveVisitPlan, computeTotalSessions } from "../utils/visitPlan.js";
import { sendPaymentConfirmation } from "./email.service.js";
import { getOrCreateStripeCustomer } from "./payment.shared.js";

export const createPaymentIntent = async (bookingId, userId, paymentMethodId = null, idempotencyKey = null) => {
    const booking = await prisma.booking.findUnique({
        where: { id: bookingId },
        include: {
            customer: { include: { user: true } },
            therapist: { select: { id: true, userId: true, fullName: true, stripeAccountId: true, user: true } },
            visitTypeRef: true,
            offer: {
                include: {
                    visitTypeRef: true,
                    request: { include: { visitTypeRef: true } },
                },
            },
        },
    });

    if (!booking) throw new Error("Booking not found");
    if (booking.customer.userId !== userId) throw new Error("Unauthorized");
    if (!["pending", "accepted"].includes(booking.status)) throw new Error("Booking must be in pending or accepted status");

    const plan = resolveVisitPlan({ booking, offer: booking.offer, request: booking.offer?.request });
    const totalSessions = computeTotalSessions(plan);
    const perSessionRate = parseFloat(booking.rate);
    const amount = perSessionRate * totalSessions;

    let feePercent;
    try {
        feePercent = await getCommissionRate();
    } catch (err) {
        logger.error("[PaymentService] Commission rate lookup failed, using env fallback", {
            therapistId: booking.therapist.id,
            error: err.message,
        });
        feePercent = stripeConfig.platformFeePercentage / 100;
    }

    const platformFee = amount * feePercent;
    const therapistPayout = amount - platformFee;

    if (idempotencyKey) {
        const cached = await prisma.payment.findUnique({ where: { idempotencyKey } });
        if (cached) {
            const cachedIntent = await stripe.paymentIntents.retrieve(cached.stripePaymentIntentId);
            return { clientSecret: cachedIntent.client_secret, payment: cached };
        }
    }

    const existingPayment = await prisma.payment.findUnique({ where: { bookingId: booking.id } });
    let stalePaymentToReuse = null;

    if (existingPayment) {
        const paymentIntent = await stripe.paymentIntents.retrieve(existingPayment.stripePaymentIntentId);

        switch (paymentIntent.status) {
            case "succeeded":
                return { status: "succeeded", payment: existingPayment };
            case "processing":
                return { status: "processing", payment: existingPayment };
            case "requires_action": {
                const intentPmId = paymentIntent.payment_method?.id ?? paymentIntent.payment_method;
                if (paymentMethodId && intentPmId && intentPmId !== paymentMethodId) {
                    await stripe.paymentIntents.cancel(paymentIntent.id).catch((err) => {
                        logger.warn("[PaymentService] Failed to cancel stale requires_action intent", { intentId: paymentIntent.id, error: err.message });
                    });
                    stalePaymentToReuse = existingPayment;
                    break;
                }
                return { status: "requires_action", clientSecret: paymentIntent.client_secret, payment: existingPayment };
            }
            case "canceled":
            case "requires_payment_method":
                if (paymentIntent.status !== "canceled") {
                    await stripe.paymentIntents.cancel(paymentIntent.id).catch((err) => {
                        logger.warn("[PaymentService] Failed to cancel stale intent", { intentId: paymentIntent.id, error: err.message });
                    });
                }
                stalePaymentToReuse = existingPayment;
                break;
            default:
                return { clientSecret: paymentIntent.client_secret, payment: existingPayment };
        }
    }

    const { stripeCustomerId } = await getOrCreateStripeCustomer(userId);

    const intentParams = {
        amount: Math.round(amount * 100),
        currency: "usd",
        customer: stripeCustomerId,
        payment_method_types: ["card"],
        payment_method_options: { card: { request_three_d_secure: "automatic" } },
        metadata: {
            bookingId: booking.id,
            customerId: booking.customer.id,
            therapistId: booking.therapist.id,
            platformFee: platformFee.toFixed(2),
            therapistPayout: therapistPayout.toFixed(2),
        },
        description: `Therapy session with ${booking.therapist.fullName}`,
        capture_method: "automatic",
    };

    if (paymentMethodId) {
        intentParams.payment_method = paymentMethodId;
        intentParams.confirm = true;
        intentParams.return_url = `${process.env.FRONTEND_URL}/customer/bookings/${bookingId}`;
    } else {
        intentParams.setup_future_usage = "off_session";
    }

    const paymentIntent = await stripe.paymentIntents.create(intentParams);

    let payment;
    if (stalePaymentToReuse) {
        payment = await prisma.payment.update({
            where: { id: stalePaymentToReuse.id },
            data: { stripePaymentIntentId: paymentIntent.id, amount, platformFee, therapistPayout, status: "intent_created" },
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
                    status: "intent_created",
                    ...(idempotencyKey && { idempotencyKey }),
                },
            });
        } catch (err) {
            if (err.code === "P2002") {
                await stripe.paymentIntents.cancel(paymentIntent.id).catch((cancelErr) => {
                    logger.warn("[PaymentService] Failed to cancel orphaned intent after P2002", { intentId: paymentIntent.id, error: cancelErr.message });
                });
                const existing = await prisma.payment.findUnique({ where: { bookingId: booking.id } });
                if (existing) {
                    const existingIntent = await stripe.paymentIntents.retrieve(existing.stripePaymentIntentId);
                    return { clientSecret: existingIntent.client_secret, payment: existing };
                }
                throw new Error("Payment creation conflict — please retry");
            }
            throw err;
        }
    }

    logAction({
        actorId: userId,
        action: "payment.intent_created",
        entityType: "payment",
        entityId: payment.id,
        changes: { bookingId, amount, platformFee: platformFee.toFixed(2), therapistPayout: therapistPayout.toFixed(2) },
    });

    if (paymentIntent.status === "succeeded") return { status: "succeeded", payment };
    if (paymentIntent.status === "requires_action") return { status: "requires_action", clientSecret: paymentIntent.client_secret, payment };

    return { clientSecret: paymentIntent.client_secret, payment };
};

export const handlePaymentSuccess = async (paymentIntentId, stripeEventId) => {
    const payment = await prisma.payment.findUnique({
        where: { stripePaymentIntentId: paymentIntentId },
        include: {
            booking: {
                include: {
                    visitTypeRef: true,
                    offer: {
                        include: {
                            visitTypeRef: true,
                            request: { include: { visitTypeRef: true } },
                        },
                    },
                    sessions: true,
                },
            },
        },
    });

    if (!payment) throw new Error("Payment not found");
    if (payment.status === "escrowed") return payment;

    const plan = resolveVisitPlan({
        booking: payment.booking,
        offer: payment.booking.offer,
        request: payment.booking.offer?.request,
    });
    const totalSessions = computeTotalSessions(plan);

    const stripeIntent = await stripe.paymentIntents.retrieve(paymentIntentId, { expand: ["charges"] });
    const tds = stripeIntent.charges?.data?.[0]?.payment_method_details?.card?.three_d_secure;
    if (tds?.result === "not_supported" || tds?.result == null) {
        logger.warn("[PaymentService] No 3DS liability shift", { paymentIntentId, bookingId: payment.bookingId, result: tds?.result ?? "none" });
    }

    await prisma.$transaction(async (tx) => {
        await tx.processedWebhookEvent.create({ data: { stripeEventId, eventType: "payment_intent.succeeded" } });
        await tx.payment.update({
            where: { id: payment.id },
            data: {
                status: "escrowed",
                escrowedAt: new Date(),
                threeDSecureResult: tds?.result ?? null,
                threeDSecureVersion: tds?.version ?? null,
            },
        });
        await tx.booking.update({ where: { id: payment.bookingId }, data: { status: BOOKING_STATUS.CONFIRMED } });

        if (payment.booking.sessions?.length === 0) {
            const sessionRows = Array.from({ length: totalSessions }, (_, i) => ({
                bookingId: payment.bookingId,
                sessionNumber: i + 1,
                scheduledDate: i === 0 ? payment.booking.scheduledDate : null,
                status: i === 0 ? SESSION_STATUS.SCHEDULED : SESSION_STATUS.PENDING_SCHEDULE,
            }));
            await tx.session.createMany({ data: sessionRows });
        }
    }, { timeout: 15000 });

    logSystemEvent({
        action: "payment.escrow_funded",
        entityType: "payment",
        entityId: payment.id,
        changes: { bookingId: payment.bookingId, amount: parseFloat(payment.amount), stripePaymentIntentId: paymentIntentId },
    });

    const bookingWithDetails = await prisma.booking.findUnique({
        where: { id: payment.bookingId },
        include: {
            customer: { include: { user: { select: { id: true, email: true } } } },
            therapist: { select: { userId: true, fullName: true } },
        },
    });

    if (bookingWithDetails) {
        const payCustomerUserId = bookingWithDetails.customer.user.id;
        const payTherapistUserId = bookingWithDetails.therapist?.userId;
        const payPatientId = bookingWithDetails.patientId || null;
        if (payCustomerUserId && payTherapistUserId) {
            findOrCreateDirectConversation(payCustomerUserId, payTherapistUserId, payPatientId)
                .then((conversation) =>
                    createSystemMessage({
                        conversationId: conversation.id,
                        actorId: payCustomerUserId,
                        recipientId: payTherapistUserId,
                        content: `Payment received — session confirmed. ($${parseFloat(payment.amount)})`,
                        systemType: "payment_confirmed",
                        bookingId: payment.bookingId,
                    })
                )
                .catch(() => {});
        }

        sendPaymentConfirmation({ customer: bookingWithDetails.customer, booking: bookingWithDetails, payment }).catch(() => {});
    }

    return payment;
};
