import { BOOKING_STATUS, SESSION_STATUS } from "../utils/constants.js";
import { prisma } from "../config/prisma.js";
import { NotFoundError, ConflictError, BadRequestError } from "../utils/errors.js";
import { logger } from "../config/logger.js";
import { stripe } from "../config/stripe.js";
import { sendAdminPaymentReleased, sendAdminPaymentRefunded } from "./email.service.js";
import { PAYMENT_INCLUDE } from "./admin.payment.queries.service.js";

/**
 * Admin-forced release of an escrowed payment.
 * Supports full release (default) or partial release via optional `partialAmount`.
 * Bypasses the "confirmed_by_customer" session requirement.
 *
 * @param {string} paymentId
 * @param {string} adminId
 * @param {number} [partialAmount]
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
    if (payment.status !== "escrowed") throw new ConflictError(`Payment cannot be released in status '${payment.status}'`);
    if (!payment.therapist.stripeAccountId) throw new BadRequestError("Therapist has not connected a Stripe account");

    const fullPayout = parseFloat(payment.therapistPayout);

    if (partialAmount !== undefined && partialAmount !== null) {
        if (partialAmount <= 0) throw new BadRequestError("Release amount must be greater than zero");
        if (partialAmount > fullPayout) throw new BadRequestError(`Release amount ($${partialAmount}) cannot exceed therapist payout ($${fullPayout})`);
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
        }, { idempotencyKey: `admin-release-${paymentId}-${adminId}` });
    } catch (err) {
        logger.error("[AdminPaymentService] Stripe transfer failed", { paymentId, error: err.message });
        throw err;
    }

    const totalAmount = parseFloat(payment.amount);
    const totalFee = parseFloat(payment.platformFee);
    const feeRatio = totalAmount > 0 ? totalFee / totalAmount : 0;
    const releasedFeeIncrement = parseFloat((releaseAmount * feeRatio).toFixed(2));
    const alreadyReleasedFee = parseFloat(payment.releasedFee ?? 0);
    const newReleasedFee = parseFloat((alreadyReleasedFee + releasedFeeIncrement).toFixed(2));

    const updated = await prisma.payment.update({
        where: { id: paymentId },
        data: {
            status: isPartial ? "partially_released" : "released",
            stripeTransferId: transfer.id,
            releasedAt: new Date(),
            releasedAmount: releaseAmount,
            releasedFee: newReleasedFee,
        },
        include: PAYMENT_INCLUDE,
    });

    sendAdminPaymentReleased({ therapist: updated.therapist, amount: releaseAmount, booking: updated.booking }).catch(logger.error);
    logger.info("[AdminPaymentService] Payment released", { paymentId, byAdmin: adminId, transferId: transfer.id, amount: releaseAmount, partial: isPartial });
    return updated;
};

/**
 * Admin release of the remaining balance on a partially released payment.
 *
 * @param {string} paymentId
 * @param {string} adminId
 */
export const adminReleaseRemainder = async (paymentId, adminId) => {
    const payment = await prisma.payment.findUnique({
        where: { id: paymentId },
        include: { therapist: true, booking: { include: { sessions: { orderBy: { sessionNumber: "asc" } } } } },
    });
    if (!payment) throw new NotFoundError("Payment not found");
    if (payment.status !== "partially_released") throw new ConflictError(`Only partially released payments can have their remainder released (current: '${payment.status}')`);
    if (!payment.therapist.stripeAccountId) throw new BadRequestError("Therapist has not connected a Stripe account");

    const fullPayout = parseFloat(payment.therapistPayout);
    const alreadyReleased = parseFloat(payment.releasedAmount ?? 0);
    const remainder = parseFloat((fullPayout - alreadyReleased).toFixed(2));

    if (remainder <= 0) throw new BadRequestError("No remaining balance to release");

    let transfer;
    try {
        transfer = await stripe.transfers.create({
            amount: Math.round(remainder * 100),
            currency: "usd",
            destination: payment.therapist.stripeAccountId,
            metadata: { paymentId: payment.id, bookingId: payment.bookingId, releasedByAdmin: adminId, isRemainder: "true" },
            description: `Remainder payout for booking ${payment.bookingId}`,
        }, { idempotencyKey: `admin-release-remainder-${paymentId}-${adminId}` });
    } catch (err) {
        logger.error("[AdminPaymentService] Stripe remainder transfer failed", { paymentId, error: err.message });
        throw err;
    }

    const totalFee = parseFloat(payment.platformFee);
    const alreadyReleasedFee = parseFloat(payment.releasedFee ?? 0);
    // Remainder fee = total platform fee minus what's already been recorded as released
    const remainderFee = parseFloat((totalFee - alreadyReleasedFee).toFixed(2));
    const newReleasedFee = parseFloat((alreadyReleasedFee + Math.max(0, remainderFee)).toFixed(2));

    const updated = await prisma.payment.update({
        where: { id: paymentId },
        data: { status: "released", releasedAmount: fullPayout, releasedFee: newReleasedFee, releasedAt: new Date() },
        include: PAYMENT_INCLUDE,
    });

    if (payment.booking) {
        await prisma.booking.update({ where: { id: payment.bookingId }, data: { status: BOOKING_STATUS.COMPLETED } });
    }

    sendAdminPaymentReleased({ therapist: updated.therapist, amount: remainder, booking: updated.booking }).catch(logger.error);
    logger.info("[AdminPaymentService] Payment remainder released", { paymentId, byAdmin: adminId, transferId: transfer.id, remainder, totalReleased: fullPayout });
    return updated;
};

/**
 * Admin refund — transfers full payment amount to customer Connect account.
 * Never uses stripe.refunds.create(). If customer has no Connect account,
 * creates a pending_connect CustomerRefund for later transfer.
 *
 * @param {string} paymentId
 * @param {string} reason
 * @param {string} adminId
 */
export const adminRefundPayment = async (paymentId, reason, adminId) => {
    const payment = await prisma.payment.findUnique({
        where: { id: paymentId },
        include: {
            booking: { include: { sessions: { orderBy: { sessionNumber: "asc" } } } },
            customer: {
                select: {
                    id: true,
                    userId: true,
                    fullName: true,
                    stripeAccountId: true,
                    stripeOnboardingComplete: true,
                    user: { select: { email: true } },
                },
            },
        },
    });
    if (!payment) throw new NotFoundError("Payment not found");
    if (!["escrowed", "intent_created"].includes(payment.status)) throw new ConflictError(`Payment cannot be refunded in status '${payment.status}'`);
    if (payment.stripeTransferId) throw new ConflictError("Payment cannot be refunded because funds have already been transferred to the therapist");
    if (!payment.stripePaymentIntentId) throw new BadRequestError("No Stripe payment intent associated with this payment");

    const { customer, booking } = payment;
    const refundAmount = parseFloat(payment.amount);
    const updatedPaymentInclude = { booking: { select: { id: true, status: true, scheduledDate: true } }, customer: { select: { fullName: true } } };

    if (payment.status === "intent_created") {
        try {
            await stripe.paymentIntents.cancel(payment.stripePaymentIntentId, { cancellation_reason: "abandoned" });
        } catch (err) {
            logger.error("[AdminPaymentService] PaymentIntent cancel failed", { paymentId, error: err.message });
            throw err;
        }

        await prisma.$transaction(async (tx) => {
            await tx.payment.update({ where: { id: paymentId }, data: { status: "refunded", refundedAt: new Date() } });
            await tx.booking.update({ where: { id: booking.id }, data: { status: BOOKING_STATUS.CANCELLED } });
            if (booking.sessions?.length > 0) {
                await tx.session.updateMany({ where: { bookingId: booking.id }, data: { status: SESSION_STATUS.CANCELLED, cancellationReason: reason } });
            }
        }, { timeout: 15000 });

        sendAdminPaymentRefunded({ customer, amount: refundAmount, booking, reason }).catch(logger.error);
        logger.info("[AdminPaymentService] Payment cancelled (intent_created)", { paymentId, byAdmin: adminId });
        return { payment: await prisma.payment.findUnique({ where: { id: paymentId }, include: updatedPaymentInclude }), refundMethod: "intent_cancelled" };
    }

    // escrowed — Connect transfer, never stripe.refunds.create()
    let stripeTransfer = null;
    if (customer.stripeAccountId && customer.stripeOnboardingComplete) {
        try {
            stripeTransfer = await stripe.transfers.create({
                amount: Math.round(refundAmount * 100),
                currency: "usd",
                destination: customer.stripeAccountId,
                metadata: { type: "customer_refund", reason: "admin_refund", bookingId: booking.id, paymentId: payment.id, refundedByAdmin: adminId },
            }, { idempotencyKey: `admin-refund-${paymentId}` });
        } catch (err) {
            logger.error("[AdminPaymentService] Connect transfer failed — creating pending_connect record", { paymentId, error: err.message });
        }
    }

    await prisma.$transaction(async (tx) => {
        await tx.payment.update({ where: { id: paymentId }, data: { status: "refunded", refundedAt: new Date(), refundedAmount: refundAmount } });
        await tx.booking.update({ where: { id: booking.id }, data: { status: BOOKING_STATUS.CANCELLED } });
        if (booking.sessions?.length > 0) {
            await tx.session.updateMany({ where: { bookingId: booking.id }, data: { status: SESSION_STATUS.CANCELLED, cancellationReason: reason } });
        }
        await tx.customerRefund.create({
            data: {
                customerId: customer.id,
                paymentId: payment.id,
                bookingId: booking.id,
                amount: refundAmount,
                reason: "admin_refund",
                status: stripeTransfer ? "transferred" : "pending_connect",
                stripeTransferId: stripeTransfer?.id ?? null,
                transferredAt: stripeTransfer ? new Date() : null,
            },
        });
    }, { timeout: 15000 });

    sendAdminPaymentRefunded({ customer, amount: refundAmount, booking, reason }).catch(logger.error);
    logger.info("[AdminPaymentService] Payment refunded via Connect transfer", { paymentId, byAdmin: adminId, refundMethod: stripeTransfer ? "connect_transfer" : "pending_connect" });

    return {
        payment: await prisma.payment.findUnique({ where: { id: paymentId }, include: updatedPaymentInclude }),
        refundMethod: stripeTransfer ? "connect_transfer" : "pending_connect",
    };
};
