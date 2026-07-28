import { SESSION_STATUS, BOOKING_STATUS } from "../utils/constants.js";
import { prisma } from "../config/prisma.js";
import { stripe } from "../config/stripe.js";
import { logger } from "../config/logger.js";
import { logSystemEvent } from "./audit.service.js";
import { trackServerEvent } from "../config/posthog.js";
import { sendPayoutConfirmation, sendPaymentReleasedToCustomer } from "./email.service.js";
import { markLinkedRequestCompleted } from "./request.service.js";
import { releasePartialSessionPayout } from "./payment.refund.service.js";
import { createPerSessionRefund } from "./payment.refund.service.js";

export const releasePayment = async (sessionId) => {
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

    if (!session) throw new Error("Session not found");
    if (session.status !== SESSION_STATUS.CONFIRMED_BY_CUSTOMER) throw new Error("Session must be confirmed by customer before payout");

    const payment = session.booking.payment;

    if (payment && payment.status === "released") return payment;
    if (!payment || !["escrowed", "partially_released"].includes(payment.status)) throw new Error("Payment not in a releasable state");

    const allSessions = await prisma.session.findMany({ where: { bookingId: session.bookingId } });
    const unconfirmedCount = allSessions.filter(s => s.status !== SESSION_STATUS.CONFIRMED_BY_CUSTOMER).length;
    if (unconfirmedCount > 0) {
        throw new Error(`Cannot release payment: ${unconfirmedCount} of ${allSessions.length} session(s) not yet confirmed by customer`);
    }

    const therapist = session.booking.therapist;
    if (!therapist.stripeAccountId) throw new Error("Therapist has not connected Stripe account");

    const fullPayout = parseFloat(payment.therapistPayout);
    const alreadyReleased = parseFloat(payment.releasedAmount ?? 0);
    const amountToRelease = payment.status === "partially_released"
        ? parseFloat((fullPayout - alreadyReleased).toFixed(2))
        : fullPayout;

    let transfer;
    try {
        transfer = await stripe.transfers.create({
            amount: Math.round(amountToRelease * 100),
            currency: "usd",
            destination: therapist.stripeAccountId,
            metadata: {
                paymentId: payment.id,
                sessionId: session.id,
                bookingId: session.bookingId,
                isRemainder: alreadyReleased > 0 ? "true" : "false",
            },
            description: alreadyReleased > 0 ? `Remainder payout for session ${session.id}` : `Payout for session ${session.id}`,
        }, { idempotencyKey: `release-${payment.id}${alreadyReleased > 0 ? "-remainder" : ""}` });
    } catch (stripeError) {
        logger.error("Transfer creation failed:", stripeError.message);
        throw new Error(`Failed to transfer payment: ${stripeError.message}`);
    }

    try {
        await prisma.payment.update({ where: { id: payment.id }, data: { stripeTransferId: transfer.id } });
    } catch (saveTransferIdError) {
        logger.error(`CRITICAL: Stripe transfer ${transfer.id} succeeded but failed to save stripeTransferId to payment ${payment.id}. Manual reconciliation required.`, {
            transferId: transfer.id, paymentId: payment.id, sessionId: session.id, bookingId: session.bookingId, error: saveTransferIdError.message,
        });
        throw new Error("Transfer succeeded but database update failed. Support has been notified.");
    }

    try {
        const updatedPayment = await prisma.payment.update({
            where: { id: payment.id },
            data: { status: "released", releasedAt: new Date(), releasedAmount: parseFloat(payment.therapistPayout) },
        });

        logSystemEvent({
            action: "payment.released_to_therapist",
            entityType: "payment",
            entityId: payment.id,
            changes: { sessionId: session.id, bookingId: session.bookingId, therapistPayout: parseFloat(payment.therapistPayout), stripeTransferId: transfer.id },
        });

        logSystemEvent({
            action: "admin_fee.applied",
            entityType: "payment",
            entityId: payment.id,
            changes: { totalAmount: parseFloat(payment.amount), platformFee: parseFloat(payment.platformFee), therapistPayout: parseFloat(payment.therapistPayout) },
        });

        sendPayoutConfirmation({ therapist: session.booking.therapist, payment: updatedPayment, booking: session.booking }).catch(() => {});
        sendPaymentReleasedToCustomer({ customer: session.booking.customer, therapist: session.booking.therapist, payment: updatedPayment, booking: session.booking }).catch(() => {});

        return updatedPayment;
    } catch (dbError) {
        logger.error(`CRITICAL: Transfer ${transfer.id} succeeded but status update to 'released' failed for payment ${payment.id}. stripeTransferId was saved. Manual status update required.`, {
            transferId: transfer.id, paymentId: payment.id, error: dbError.message,
        });
        throw new Error("Transfer succeeded but database update failed. Support has been notified.");
    }
};

export const releaseSessionPayout = async ({ session, payment, booking, isLast }) => {
    const existingPayout = await prisma.sessionPayout.findUnique({ where: { sessionId: session.id } });
    if (existingPayout) {
        logger.info("[PaymentService] Session payout already exists, skipping", { sessionId: session.id, payoutId: existingPayout.id });
        return existingPayout;
    }

    const therapist = booking.therapist;
    if (!therapist.stripeAccountId) throw new Error("Therapist has not connected Stripe account");
    if (!["escrowed", "partially_released"].includes(payment.status)) throw new Error(`Payment not in a releasable state (current: ${payment.status})`);

    const alreadyReleased = parseFloat(payment.releasedAmount ?? 0);
    const totalTherapistPayout = parseFloat(payment.therapistPayout);
    const totalAmount = parseFloat(payment.amount);
    const totalFee = parseFloat(payment.platformFee);
    const perSessionRate = parseFloat(booking.rate);

    const previousPayouts = await prisma.sessionPayout.findMany({ where: { paymentId: payment.id } });
    const previousPayoutSum = previousPayouts.reduce((sum, p) => sum + parseFloat(p.therapistPayout), 0);
    const previousFeeSum = previousPayouts.reduce((sum, p) => sum + parseFloat(p.platformFee), 0);
    const previousAmountSum = previousPayouts.reduce((sum, p) => sum + parseFloat(p.amount), 0);

    let perSessionTherapistPayout, perSessionFee, perSessionAmount;

    if (isLast) {
        perSessionTherapistPayout = parseFloat((totalTherapistPayout - previousPayoutSum).toFixed(2));
        perSessionFee = parseFloat((totalFee - previousFeeSum).toFixed(2));
        perSessionAmount = parseFloat((totalAmount - previousAmountSum).toFixed(2));
    } else {
        perSessionAmount = perSessionRate;
        perSessionFee = Math.floor(perSessionRate * (totalFee / totalAmount) * 100) / 100;
        perSessionTherapistPayout = parseFloat((perSessionAmount - perSessionFee).toFixed(2));
    }

    if (perSessionTherapistPayout <= 0) {
        logger.warn("[PaymentService] Per-session payout is zero or negative, skipping transfer", { sessionId: session.id, perSessionTherapistPayout, isLast });
        return null;
    }

    let transfer;
    try {
        transfer = await stripe.transfers.create({
            amount: Math.round(perSessionTherapistPayout * 100),
            currency: "usd",
            destination: therapist.stripeAccountId,
            metadata: { paymentId: payment.id, sessionId: session.id, bookingId: booking.id, sessionNumber: session.sessionNumber, isPerSession: "true" },
            description: `Session ${session.sessionNumber} payout for booking ${booking.id}`,
        }, { idempotencyKey: `session-payout-${session.id}` });
    } catch (stripeError) {
        logger.error("[PaymentService] Per-session transfer failed", { sessionId: session.id, error: stripeError.message });
        throw new Error(`Failed to transfer session payout: ${stripeError.message}`);
    }

    const newReleasedAmount = parseFloat((alreadyReleased + perSessionTherapistPayout).toFixed(2));
    const alreadyReleasedFee = parseFloat(payment.releasedFee ?? 0);
    const newReleasedFee = parseFloat((alreadyReleasedFee + perSessionFee).toFixed(2));
    const allSessionsPaid = isLast || newReleasedAmount >= totalTherapistPayout - 0.01;

    const sessionPayout = await prisma.$transaction(async (tx) => {
        const payout = await tx.sessionPayout.create({
            data: { sessionId: session.id, paymentId: payment.id, stripeTransferId: transfer.id, amount: perSessionAmount, platformFee: perSessionFee, therapistPayout: perSessionTherapistPayout },
        });
        await tx.payment.update({
            where: { id: payment.id },
            data: { releasedAmount: newReleasedAmount, releasedFee: newReleasedFee, status: allSessionsPaid ? "released" : "partially_released", ...(allSessionsPaid && { releasedAt: new Date() }) },
        });
        return payout;
    });

    logSystemEvent({
        action: "payment.released_to_therapist",
        entityType: "session_payout",
        entityId: sessionPayout.id,
        changes: { sessionId: session.id, bookingId: booking.id, therapistPayout: perSessionTherapistPayout, stripeTransferId: transfer.id, sessionNumber: session.sessionNumber, isLast },
    });

    logger.info("[PaymentService] Per-session payout released", { sessionId: session.id, sessionNumber: session.sessionNumber, bookingId: booking.id, amount: perSessionTherapistPayout, transferId: transfer.id, isLast, newReleasedAmount });

    if (booking.therapist?.userId) {
        trackServerEvent(booking.therapist.userId, "payout_sent", { amount: perSessionTherapistPayout, session_number: session.sessionNumber, is_last: isLast });
    }

    return sessionPayout;
};

export const finalizeBooking = async (bookingId, therapistId) => {
    const booking = await prisma.booking.findUnique({
        where: { id: bookingId },
        include: {
            therapist: { include: { user: { select: { id: true, email: true } } } },
            customer: { include: { user: { select: { id: true, email: true } } } },
            payment: { include: { sessionPayouts: true } },
            sessions: { orderBy: { sessionNumber: "asc" } },
        },
    });

    if (!booking) throw new Error("Booking not found");
    if (booking.therapistId !== therapistId) throw new Error("Unauthorized");
    if (booking.status === BOOKING_STATUS.FINALIZED) return booking;
    if (![BOOKING_STATUS.CONFIRMED, BOOKING_STATUS.IN_PROGRESS].includes(booking.status)) throw new Error(`Booking cannot be finalized in '${booking.status}' status`);

    const payment = booking.payment;
    if (!payment || !["escrowed", "partially_released"].includes(payment.status)) throw new Error("Payment not in a releasable state");

    const confirmedSessions = booking.sessions.filter(s => s.status === SESSION_STATUS.CONFIRMED_BY_CUSTOMER);
    const undeliveredSessions = booking.sessions.filter(s =>
        s.status !== SESSION_STATUS.CONFIRMED_BY_CUSTOMER &&
        s.status !== BOOKING_STATUS.CANCELLED &&
        s.status !== SESSION_STATUS.MISSED &&
        s.status !== SESSION_STATUS.ATTEMPTED
    );

    if (confirmedSessions.length === 0) throw new Error("No confirmed sessions to finalize. Use cancellation instead.");
    if (undeliveredSessions.length === 0) throw new Error("All sessions are confirmed. This booking should be completed, not finalized.");

    const paidSessionIds = new Set(booking.payment.sessionPayouts.map(p => p.sessionId));
    const unpaidConfirmedSessions = confirmedSessions.filter(s => !paidSessionIds.has(s.id));

    for (let i = 0; i < unpaidConfirmedSessions.length; i++) {
        const session = unpaidConfirmedSessions[i];
        const currentPayment = await prisma.payment.findUnique({ where: { id: payment.id } });
        const payout = await releaseSessionPayout({ session, payment: currentPayment, booking, isLast: false });
        if (payout) { /* collected */ }
    }

    await prisma.$transaction(async (tx) => {
        await tx.session.updateMany({
            where: { id: { in: undeliveredSessions.map(s => s.id) } },
            data: { status: BOOKING_STATUS.CANCELLED, cancellationReason: "Series finalized by therapist" },
        });
        if (undeliveredSessions.length > 0) {
            await tx.subscription.updateMany({
                where: {
                    customerId: booking.customer.id,
                    status: { in: ["active", "trialing", "grace_period", "past_due"] },
                    sessionsUsed: { gte: undeliveredSessions.length },
                },
                data: { sessionsUsed: { decrement: undeliveredSessions.length } },
            });
        }
    });

    const perSessionRate = parseFloat(booking.rate);
    const refundAmount = parseFloat((undeliveredSessions.length * perSessionRate).toFixed(2));

    const refreshedPayment = await prisma.payment.findUnique({ where: { id: payment.id } });
    const totalReleased = parseFloat(refreshedPayment.releasedAmount ?? 0);

    let customerRefund = null;
    let stripeTransfer = null;

    if (refundAmount > 0) {
        const customer = booking.customer;

        if (customer.stripeAccountId && customer.stripeOnboardingComplete) {
            try {
                stripeTransfer = await stripe.transfers.create({
                    amount: Math.round(refundAmount * 100),
                    currency: "usd",
                    destination: customer.stripeAccountId,
                    metadata: { type: "customer_refund", bookingId: booking.id, paymentId: payment.id, reason: "series_finalized", undeliveredSessions: undeliveredSessions.length },
                }, { idempotencyKey: `finalize-refund-${booking.id}` });

                customerRefund = await prisma.customerRefund.create({
                    data: { customerId: customer.id, paymentId: payment.id, bookingId: booking.id, amount: refundAmount, status: "transferred", stripeTransferId: stripeTransfer.id, transferredAt: new Date(), reason: "series_finalized" },
                });

                logger.info("[PaymentService] Refund transferred to customer Connect account", { bookingId: booking.id, refundAmount, transferId: stripeTransfer.id });
            } catch (stripeError) {
                logger.error("[PaymentService] CRITICAL: Refund transfer failed — creating pending record instead", { bookingId: booking.id, refundAmount, error: stripeError.message });
            }
        }

        if (!customerRefund) {
            customerRefund = await prisma.customerRefund.create({
                data: { customerId: customer.id, paymentId: payment.id, bookingId: booking.id, amount: refundAmount, status: "pending_connect", reason: "series_finalized" },
            });
            logger.info("[PaymentService] Pending refund created (awaiting customer Connect setup)", { bookingId: booking.id, refundAmount, expiresAt: customerRefund.expiresAt, customerHasConnect: !!customer.stripeAccountId });
        }
    }

    const updatedPayment = await prisma.payment.update({
        where: { id: payment.id },
        data: { status: "released", releasedAt: new Date(), refundedAmount: refundAmount > 0 ? refundAmount : undefined, refundedAt: refundAmount > 0 ? new Date() : undefined },
    });

    await prisma.booking.update({ where: { id: booking.id }, data: { status: BOOKING_STATUS.FINALIZED } });

    markLinkedRequestCompleted(booking.id).catch((err) =>
        logger.error("[PaymentService] markLinkedRequestCompleted failed after therapist FINALIZED", { bookingId: booking.id, error: err.message })
    );

    logSystemEvent({
        action: "booking.finalized",
        entityType: "booking",
        entityId: booking.id,
        changes: { confirmedSessions: confirmedSessions.length, undeliveredSessions: undeliveredSessions.length, totalReleased, refundAmount, refundMethod: stripeTransfer ? "connect_transfer" : "pending_connect", customerRefundId: customerRefund?.id, stripeTransferId: stripeTransfer?.id },
    });

    logSystemEvent({
        action: "admin_fee.applied",
        entityType: "payment",
        entityId: payment.id,
        changes: { totalAmount: parseFloat(payment.amount), platformFee: parseFloat(payment.platformFee), therapistPayout: totalReleased, refundedAmount: refundAmount },
    });

    sendPayoutConfirmation({ therapist: booking.therapist, payment: updatedPayment, booking }).catch(() => {});

    if (refundAmount > 0) {
        const { sendCustomerRefundTransferred, sendCustomerRefundAvailable } = await import("./email.service.js");
        if (customerRefund?.status === "transferred") {
            sendCustomerRefundTransferred({ customer: booking.customer, refundAmount }).catch(() => {});
        } else {
            sendCustomerRefundAvailable({ customer: booking.customer, therapist: booking.therapist, refundAmount, bookingId: booking.id }).catch(() => {});
        }
    }

    logger.info("[PaymentService] Booking finalized", { bookingId: booking.id, confirmedSessions: confirmedSessions.length, undeliveredSessions: undeliveredSessions.length, totalReleased, refundAmount });

    return { booking: { ...booking, status: BOOKING_STATUS.FINALIZED }, payment: updatedPayment, paidSessions: confirmedSessions.length, refundedSessions: undeliveredSessions.length, refundAmount, customerRefund };
};
