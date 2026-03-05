import { prisma } from "../config/prisma.js";
import { NotFoundError, ConflictError, BadRequestError } from "../utils/errors.js";
import { logger } from "../config/logger.js";
import { stripe } from "../config/stripe.js";
import { createNotification } from "./notification.service.js";

const PAYMENT_INCLUDE = {
    booking: {
        select: { id: true, scheduledDate: true, sessionType: true, status: true },
    },
    customer: {
        select: {
            id: true,
            userId: true,
            fullName: true,
            user: { select: { email: true } },
        },
    },
    therapist: {
        select: {
            id: true,
            userId: true,
            fullName: true,
            stripeAccountId: true,
            user: { select: { email: true } },
        },
    },
};

export const adminListPayments = async ({ status, page = 1, limit = 20 } = {}) => {
    const where = {};
    if (status) where.status = status;

    const [payments, total] = await Promise.all([
        prisma.payment.findMany({
            where,
            include: PAYMENT_INCLUDE,
            orderBy: { createdAt: "desc" },
            skip: (page - 1) * limit,
            take: limit,
        }),
        prisma.payment.count({ where }),
    ]);

    return {
        payments,
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
}

export const adminGetPayment = async (paymentId) => {
    const payment = await prisma.payment.findUnique({
        where: { id: paymentId },
        include: PAYMENT_INCLUDE,
    });
    if (!payment) throw new NotFoundError("Payment not found");
    return payment;
};

export const adminGetPaymentStats = async () => {
    const [totalVolume, platformRevenue, therapistPayouts, refunded, escrowed] = await Promise.all([
        prisma.payment.aggregate({
            _sum: { amount: true },
            where: { status: { in: ["escrowed", "released"] } },
        }),
        prisma.payment.aggregate({
            _sum: { platformFee: true },
            where: { status: "released" },
        }),
        prisma.payment.aggregate({
            _sum: { therapistPayout: true },
            where: { status: "released" },
        }),
        prisma.payment.aggregate({
            _sum: { amount: true },
            where: { status: "refunded" },
        }),
        prisma.payment.aggregate({
            _sum: { amount: true },
            where: { status: "escrowed" },
        }),
    ]);

    return {
        totalVolume: parseFloat(totalVolume._sum.amount ?? 0),
        platformRevenue: parseFloat(platformRevenue._sum.platformFee ?? 0),
        therapistPayouts: parseFloat(therapistPayouts._sum.therapistPayout ?? 0),
        totalRefunded: parseFloat(refunded._sum.amount ?? 0),
        escrowedFunds: parseFloat(escrowed._sum.amount ?? 0),
    };
}

/**
 * Admin-forced released of an escrowed payment.
 * Bypasses the "confirmed_by_therapist" session requirement.
 */
export const adminReleasePayment = async (paymentId, adminId) => {
    const payment = await prisma.payment.findUnique({
        where: { id: paymentId },
        include: {
            therapist: true,
            booking: { include: { session: true } },
            customer: { select: { userId: true } },
        },
    });
    if (!payment) throw new NotFoundError("Payment not found");
    if (payment.status !== "escrowed") {
        throw new ConflictError(
            `Payment cannot be released in status '${payment.status}'`
        );
    }
    if (!payment.therapist.stripeAccountId) {
        throw new BadRequestError("Therapist has not connected a Stripe account");
    }

    let transfer;
    try {
        transfer = await stripe.transfers.create({
            amount: Math.round(parseFloat(payment.therapistPayout) * 100),
            currency: "usd",
            destination: payment.therapist.stripeAccountId,
            metadata: {
                paymentId: payment.id,
                bookingId: payment.bookingId,
                releasedByAdmin: adminId,
            },
            description: `Admin-forced payout for booking ${payment.bookingId}`,
        })
    } catch (stripeError) {
        logger.error("[AdminPaymentService] Stripe transfer failed", {
            paymentId,
            error: stripeError.message,
        });
        throw stripeError;
    }

    const updated = await prisma.payment.update({
        where: { id: paymentId },
        data: {
            status: "released",
            stripeTransferId: transfer.id,
            releasedAt: new Date(),
        },
        include: PAYMENT_INCLUDE,
    });

    createNotification({
        userId: payment.therapist.userId,
        type: "payment_released",
        title: "Payment Released",
        message: `A payment of $${parseFloat(payment.therapistPayout).toFixed(2)} has been released to your account.`,
        entityType: "payment",
        entityId: paymentId,
    }).catch(() => { });

    logger.info("[AdminPaymentService] Payment released", {
        paymentId,
        byAdmin: adminId,
        transferId: transfer.id,
    });
    return updated;
}

/**
 * Admin refund - Handles Stripe + DB + booking/session cancellation atomically
 */
export const adminRefundPayment = async (paymentId, reason, adminId) => {
    const payment = await prisma.payment.findUnique({
        where: { id: paymentId },
        include: {
            booking: { include: { session: true } },
            customer: { select: { userId: true } },
        },
    });
    if (!payment) throw new NotFoundError("Payment not found");
    if (!["escrowed", "intent_created"].includes(payment.status)) {
        throw new ConflictError(
            `Payment cannot be refunded in status '${payment.status}'`
        );
    }
    if (!payment.stripePaymentIntentId) {
        throw new BadRequestError("No Stripe payment intent associated with this payment");
    }

    let refund;
    try {
        refund = await stripe.refunds.create({
            payment_intent: payment.stripePaymentIntentId,
            reason: "requested_by_customer",
            metadata: {
                paymentId: payment.id,
                refundReason: reason,
                refundedByAdmin: adminId,
            },
        });
    } catch (stripeError) {
        logger.error("[AdminPaymentService] Stripe refund failed", {
            paymentId,
            error: stripeError.message,
        });
        throw stripeError;
    }

    await prisma.$transaction([
        prisma.payment.update({
            where: { id: paymentId },
            data: { status: "refunded", refundedAt: new Date() },
        }),
        prisma.booking.update({
            where: { id: payment.bookingId },
            data: { status: "cancelled" },
        }),
        ...(payment.booking.session
            ? [
                prisma.session.update({
                    where: { id: payment.booking.session.id },
                    data: { status: "cancelled", cancellationReason: reason }
                }),
            ]
            : []),
    ]);

    createNotification({
        userId: payment.customer.userId,
        type: "payment_refunded",
        title: "Payment Refunded",
        message: `A refund of $${parseFloat(payment.amount).toFixed(2)} has been processed for your booking.`,
        entityType: "payment",
        entityId: paymentId,
    }).catch(() => { });

    logger.info("[AdminPaymentService] Payment refunded", {
        paymentId,
        byAdmin: adminId,
        refundId: refund.id,
    });
    return refund;
}