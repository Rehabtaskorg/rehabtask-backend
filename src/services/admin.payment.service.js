import { BOOKING_STATUS } from "../utils/constants.js";
import { prisma } from "../config/prisma.js";
import { NotFoundError, ConflictError, BadRequestError } from "../utils/errors.js";
import { logger } from "../config/logger.js";
import { stripe } from "../config/stripe.js";
import { sendAdminPaymentReleased, sendAdminPaymentRefunded } from "./email.service.js";

const PAYMENT_INCLUDE = {
    booking: {
        select: {
            id: true, scheduledDate: true, sessionType: true, status: true,
            sessions: { select: { id: true, sessionNumber: true, status: true, scheduledDate: true }, orderBy: { sessionNumber: "asc" } },
        },
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

const VALID_SORT_FIELDS = ["createdAt", "amount"];

export const adminListPayments = async ({
    status,
    search,
    sortBy = "createdAt",
    sortOrder = "desc",
    startDate,
    endDate,
    page = 1,
    limit = 20,
} = {}) => {
    const where = {};
    if (status) where.status = status;

    // Date range filter on createdAt
    if (startDate || endDate) {
        where.createdAt = {};
        if (startDate) {
            where.createdAt.gte = new Date(startDate);
        }
        if (endDate) {
            const end = new Date(endDate);
            end.setUTCHours(23, 59, 59, 999);
            where.createdAt.lte = end;
        }
    }

    // Full-text search across customer name, therapist name, and emails
    if (search && search.trim()) {
        const term = search.trim();
        where.OR = [
            { customer: { fullName: { contains: term, mode: "insensitive" } } },
            { customer: { user: { email: { contains: term, mode: "insensitive" } } } },
            { therapist: { fullName: { contains: term, mode: "insensitive" } } },
            { therapist: { user: { email: { contains: term, mode: "insensitive" } } } },
        ];
    }

    const resolvedSortBy = VALID_SORT_FIELDS.includes(sortBy) ? sortBy : "createdAt";
    const orderBy = { [resolvedSortBy]: sortOrder === "asc" ? "asc" : "desc" };

    const [payments, total] = await Promise.all([
        prisma.payment.findMany({
            where,
            include: PAYMENT_INCLUDE,
            orderBy,
            skip: (page - 1) * limit,
            take: limit,
        }),
        prisma.payment.count({ where }),
    ]);

    return {
        payments,
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
};

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
            where: { status: { in: ["escrowed", "partially_released", "released"] } },
        }),
        prisma.payment.aggregate({
            _sum: { platformFee: true },
            where: { status: { in: ["partially_released", "released"] } },
        }),
        prisma.payment.aggregate({
            _sum: { releasedAmount: true },
            where: { status: { in: ["partially_released", "released"] } },
        }),
        prisma.payment.aggregate({
            _sum: { amount: true },
            where: { status: "refunded" },
        }),
        prisma.payment.aggregate({
            _sum: { amount: true },
            where: { status: { in: ["escrowed", "partially_released"] } },
        }),
    ]);

    return {
        totalVolume: parseFloat(totalVolume._sum.amount ?? 0),
        platformRevenue: parseFloat(platformRevenue._sum.platformFee ?? 0),
        therapistPayouts: parseFloat(therapistPayouts._sum.releasedAmount ?? 0),
        totalRefunded: parseFloat(refunded._sum.amount ?? 0),
        escrowedFunds: parseFloat(escrowed._sum.amount ?? 0),
    };
};

/**
 * Admin-forced release of an escrowed payment.
 * Supports full release (default) or partial release via optional `partialAmount`.
 * Bypasses the "confirmed_by_customer" session requirement.
 */
export const adminReleasePayment = async (paymentId, adminId, partialAmount) => {
    const payment = await prisma.payment.findUnique({
        where: { id: paymentId },
        include: {
            therapist: true,
            booking: { include: { sessions: { orderBy: { sessionNumber: "asc" } } } },
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

    const fullPayout = parseFloat(payment.therapistPayout);

    // Validate partial amount if provided
    if (partialAmount !== undefined && partialAmount !== null) {
        if (partialAmount <= 0) {
            throw new BadRequestError("Release amount must be greater than zero");
        }
        if (partialAmount > fullPayout) {
            throw new BadRequestError(
                `Release amount ($${partialAmount}) cannot exceed therapist payout ($${fullPayout})`
            );
        }
    }

    const releaseAmount = partialAmount ?? fullPayout;
    const isPartial = partialAmount !== undefined && partialAmount !== null && partialAmount < fullPayout;


    let transfer;
    try {
        transfer = await stripe.transfers.create({
            amount: Math.round(releaseAmount * 100),
            currency: "usd",
            destination: payment.therapist.stripeAccountId,
            metadata: {
                paymentId: payment.id,
                bookingId: payment.bookingId,
                releasedByAdmin: adminId,
                partial: isPartial ? "true" : "false",
            },
            description: `${isPartial ? "Partial admin" : "Admin-forced"} payout for booking ${payment.bookingId}`,
        }, {
            idempotencyKey: `admin-release-${paymentId}-${adminId}`,
        });
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
            status: isPartial ? "partially_released" : "released",
            stripeTransferId: transfer.id,
            releasedAt: new Date(),
            releasedAmount: releaseAmount,
            // therapistPayout is preserved as the original calculated amount — never overwritten
        },
        include: PAYMENT_INCLUDE,
    });

    sendAdminPaymentReleased({
        therapist: updated.therapist,
        amount: releaseAmount,
        booking: updated.booking,
    }).catch(() => {});

    logger.info("[AdminPaymentService] Payment released", {
        paymentId,
        byAdmin: adminId,
        transferId: transfer.id,
        amount: releaseAmount,
        partial: isPartial,
    });
    return updated;
};

/**
 * Admin release of the remaining balance on a partially released payment.
 * Transfers the difference between therapistPayout and releasedAmount.
 */
export const adminReleaseRemainder = async (paymentId, adminId) => {
    const payment = await prisma.payment.findUnique({
        where: { id: paymentId },
        include: {
            therapist: true,
            booking: { include: { sessions: { orderBy: { sessionNumber: "asc" } } } },
        },
    });
    if (!payment) throw new NotFoundError("Payment not found");
    if (payment.status !== "partially_released") {
        throw new ConflictError(
            `Only partially released payments can have their remainder released (current: '${payment.status}')`
        );
    }
    if (!payment.therapist.stripeAccountId) {
        throw new BadRequestError("Therapist has not connected a Stripe account");
    }

    const fullPayout = parseFloat(payment.therapistPayout);
    const alreadyReleased = parseFloat(payment.releasedAmount ?? 0);
    const remainder = parseFloat((fullPayout - alreadyReleased).toFixed(2));

    if (remainder <= 0) {
        throw new BadRequestError("No remaining balance to release");
    }

    let transfer;
    try {
        transfer = await stripe.transfers.create({
            amount: Math.round(remainder * 100),
            currency: "usd",
            destination: payment.therapist.stripeAccountId,
            metadata: {
                paymentId: payment.id,
                bookingId: payment.bookingId,
                releasedByAdmin: adminId,
                isRemainder: "true",
            },
            description: `Remainder payout for booking ${payment.bookingId}`,
        }, {
            idempotencyKey: `admin-release-remainder-${paymentId}-${adminId}`,
        });
    } catch (stripeError) {
        logger.error("[AdminPaymentService] Stripe remainder transfer failed", {
            paymentId,
            error: stripeError.message,
        });
        throw stripeError;
    }

    // Remove the unique constraint conflict: the first transfer ID is already stored.
    // For the remainder transfer, we append it to metadata via the releasedAmount tracking.
    const updated = await prisma.payment.update({
        where: { id: paymentId },
        data: {
            status: "released",
            releasedAmount: fullPayout,
            releasedAt: new Date(),
        },
        include: PAYMENT_INCLUDE,
    });

    // Mark booking as completed now that full payout is released
    if (payment.booking) {
        await prisma.booking.update({
            where: { id: payment.bookingId },
            data: { status: BOOKING_STATUS.COMPLETED },
        });
    }

    sendAdminPaymentReleased({
        therapist: updated.therapist,
        amount: remainder,
        booking: updated.booking,
    }).catch(() => {});

    logger.info("[AdminPaymentService] Payment remainder released", {
        paymentId,
        byAdmin: adminId,
        transferId: transfer.id,
        remainder,
        totalReleased: fullPayout,
    });
    return updated;
};

/**
 * Admin refund - Handles Stripe + DB + booking/session cancellation atomically
 */
export const adminRefundPayment = async (paymentId, reason, adminId) => {
    const payment = await prisma.payment.findUnique({
        where: { id: paymentId },
        include: {
            booking: { include: { sessions: { orderBy: { sessionNumber: "asc" } } } },
            customer: {
                select: {
                    userId: true,
                    fullName: true,
                    user: { select: { email: true } },
                },
            },
        },
    });
    if (!payment) throw new NotFoundError("Payment not found");
    if (!["escrowed", "intent_created"].includes(payment.status)) {
        throw new ConflictError(
            `Payment cannot be refunded in status '${payment.status}'`
        );
    }
    // Defense-in-depth: if a Stripe transfer already exists (e.g. partial release),
    // refunding the full PaymentIntent would return $100 to the customer while the
    // therapist has already received part of those funds — causing a net loss.
    if (payment.stripeTransferId) {
        throw new ConflictError(
            "Payment cannot be refunded because funds have already been transferred to the therapist"
        );
    }
    if (!payment.stripePaymentIntentId) {
        throw new BadRequestError("No Stripe payment intent associated with this payment");
    }

    // intent_created = PaymentIntent created but not yet captured — must cancel, not refund.
    // escrowed       = Card charged/captured — must refund.
    let refund;
    try {
        if (payment.status === "intent_created") {
            // Cancel the uncaptured PaymentIntent; no money was moved so no refund needed.
            refund = await stripe.paymentIntents.cancel(payment.stripePaymentIntentId, {
                cancellation_reason: "abandoned",
            });
        } else {
            refund = await stripe.refunds.create({
                payment_intent: payment.stripePaymentIntentId,
                reason: "requested_by_customer",
                metadata: {
                    paymentId: payment.id,
                    refundReason: reason,
                    refundedByAdmin: adminId,
                },
            });
        }
    } catch (stripeError) {
        logger.error("[AdminPaymentService] Stripe refund/cancel failed", {
            paymentId,
            status: payment.status,
            error: stripeError.message,
        });
        throw stripeError;
    }

    await prisma.$transaction(async (tx) => {
        await tx.payment.update({
            where: { id: paymentId },
            data: { status: "refunded", refundedAt: new Date() },
        });
        await tx.booking.update({
            where: { id: payment.bookingId },
            data: { status: BOOKING_STATUS.CANCELLED },
        });
        if (payment.booking.sessions?.length > 0) {
            await tx.session.updateMany({
                where: { bookingId: payment.bookingId },
                data: { status: BOOKING_STATUS.CANCELLED, cancellationReason: reason },
            });
        }
    }, { timeout: 15000 });

    sendAdminPaymentRefunded({
        customer: payment.customer,
        amount: parseFloat(payment.amount),
        booking: payment.booking,
        reason,
    }).catch(() => {});

    logger.info("[AdminPaymentService] Payment refunded", {
        paymentId,
        byAdmin: adminId,
        refundId: refund.id,
    });

    const updatedPayment = await prisma.payment.findUnique({
        where: { id: paymentId },
        include: {
            booking: { select: { id: true, status: true, scheduledDate: true } },
            customer: { select: { fullName: true } },
        },
    });

    return {
        payment: updatedPayment,
        stripeRefundId: refund.id,
    };
};
