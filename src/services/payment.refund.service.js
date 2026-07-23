import { prisma } from "../config/prisma.js";
import { stripe } from "../config/stripe.js";
import { logger } from "../config/logger.js";
import { logSystemEvent } from "./audit.service.js";
import {
    sendCustomerRefundTransferred,
    sendCustomerRefundAvailable,
    sendCustomerRefundPayoutFailed,
} from "./email.service.js";

export const releasePartialSessionPayout = async ({ session, payment, booking, amount }) => {
    const existingPayout = await prisma.sessionPayout.findUnique({ where: { sessionId: session.id } });
    if (existingPayout) {
        logger.info("[PaymentService] Partial session payout already exists, skipping", { sessionId: session.id, payoutId: existingPayout.id });
        return existingPayout;
    }

    const therapist = booking.therapist;
    if (!therapist.stripeAccountId) throw new Error("Therapist has not connected Stripe account");
    if (!["escrowed", "partially_released"].includes(payment.status)) throw new Error(`Payment not in a releasable state (current: ${payment.status})`);

    const grossAmount = Math.round(Number(amount) * 100) / 100;

    if (!Number.isFinite(grossAmount) || grossAmount <= 0) {
        logger.info("[PaymentService] Partial payout amount is zero or invalid — skipping Stripe transfer", { sessionId: session.id, grossAmount });
        return null;
    }

    const totalAmount = parseFloat(payment.amount);
    const totalFee = parseFloat(payment.platformFee);
    const feeRatio = totalAmount > 0 ? (totalFee / totalAmount) : 0;
    const partialFee = Math.floor(grossAmount * feeRatio * 100) / 100;
    const partialTherapistPayout = parseFloat((grossAmount - partialFee).toFixed(2));

    if (partialTherapistPayout <= 0) {
        logger.warn("[PaymentService] Partial therapist payout <= 0 after commission, skipping transfer", { sessionId: session.id, grossAmount, partialFee });
        return null;
    }

    const alreadyReleased = parseFloat(payment.releasedAmount ?? 0);
    const totalTherapistPayout = parseFloat(payment.therapistPayout);

    if (alreadyReleased + partialTherapistPayout > totalTherapistPayout + 0.01) {
        throw new Error(
            `Partial payout would exceed total therapist payout ` +
            `(alreadyReleased=${alreadyReleased}, partial=${partialTherapistPayout}, total=${totalTherapistPayout})`
        );
    }

    let transfer;
    try {
        transfer = await stripe.transfers.create({
            amount: Math.round(partialTherapistPayout * 100),
            currency: "usd",
            destination: therapist.stripeAccountId,
            metadata: {
                paymentId: payment.id, sessionId: session.id, bookingId: booking.id,
                sessionNumber: String(session.sessionNumber ?? ""), isPerSession: "true", isAttempted: "true", grossAmount: String(grossAmount),
            },
            description: `Attempted-visit payout for session ${session.sessionNumber ?? ""} (booking ${booking.id})`,
        }, { idempotencyKey: `session-attempted-payout-${session.id}` });
    } catch (stripeError) {
        logger.error("[PaymentService] Partial session transfer failed", { sessionId: session.id, error: stripeError.message });
        throw new Error(`Failed to transfer attempted-visit payout: ${stripeError.message}`);
    }

    const newReleasedAmount = parseFloat((alreadyReleased + partialTherapistPayout).toFixed(2));
    const alreadyReleasedFee = parseFloat(payment.releasedFee ?? 0);
    const newReleasedFee = parseFloat((alreadyReleasedFee + partialFee).toFixed(2));

    const sessionPayout = await prisma.$transaction(async (tx) => {
        const payout = await tx.sessionPayout.create({
            data: { sessionId: session.id, paymentId: payment.id, stripeTransferId: transfer.id, amount: grossAmount, platformFee: partialFee, therapistPayout: partialTherapistPayout },
        });
        await tx.payment.update({
            where: { id: payment.id },
            data: { releasedAmount: newReleasedAmount, releasedFee: newReleasedFee, status: "partially_released" },
        });
        return payout;
    });

    logSystemEvent({
        action: "payment.released_to_therapist",
        entityType: "session_payout",
        entityId: sessionPayout.id,
        changes: { sessionId: session.id, bookingId: booking.id, grossAmount, therapistPayout: partialTherapistPayout, platformFee: partialFee, stripeTransferId: transfer.id, sessionNumber: session.sessionNumber, isAttempted: true },
    });

    logger.info("[PaymentService] Partial session payout released (attempted visit)", { sessionId: session.id, bookingId: booking.id, grossAmount, therapistPayout: partialTherapistPayout, transferId: transfer.id, newReleasedAmount });

    return sessionPayout;
};

export const createPerSessionRefund = async ({ session, payment, customer, booking, reason, amount }) => {
    const rawAmount = amount != null ? Number(amount) : parseFloat(booking.rate);
    const refundAmount = Math.round(rawAmount * 100) / 100;

    if (!Number.isFinite(refundAmount) || refundAmount <= 0) throw new Error("Invalid refund amount");

    let customerRefund = null;
    let transfer = null;

    if (customer.stripeAccountId && customer.stripeOnboardingComplete) {
        try {
            transfer = await stripe.transfers.create({
                amount: Math.round(refundAmount * 100),
                currency: "usd",
                destination: customer.stripeAccountId,
                metadata: { type: "customer_refund", reason, bookingId: booking.id, paymentId: payment.id, sessionId: session.id },
            }, { idempotencyKey: `per-session-refund-${session.id}` });

            customerRefund = await prisma.customerRefund.create({
                data: { customerId: customer.id, paymentId: payment.id, bookingId: booking.id, sessionId: session.id, amount: refundAmount, status: "transferred", stripeTransferId: transfer.id, transferredAt: new Date(), reason },
            });

            logger.info("[PaymentService] Per-session refund transferred to customer Connect account", { sessionId: session.id, refundAmount, transferId: transfer.id });
        } catch (stripeError) {
            logger.error("[PaymentService] Per-session refund transfer failed — creating pending record instead", { sessionId: session.id, refundAmount, error: stripeError.message });
        }
    }

    if (!customerRefund) {
        customerRefund = await prisma.customerRefund.create({
            data: { customerId: customer.id, paymentId: payment.id, bookingId: booking.id, sessionId: session.id, amount: refundAmount, status: "pending_connect", reason },
        });
        logger.info("[PaymentService] Per-session refund pending (awaiting customer Connect setup)", { sessionId: session.id, refundAmount, expiresAt: customerRefund.expiresAt });
    }

    await prisma.payment.update({ where: { id: payment.id }, data: { refundedAmount: { increment: refundAmount }, refundedAt: new Date() } });

    if (customerRefund.status === "transferred") {
        sendCustomerRefundTransferred({ customer, refundAmount }).catch(() => {});
    } else {
        sendCustomerRefundAvailable({ customer, therapist: booking.therapist || { fullName: "Your therapist" }, refundAmount, bookingId: booking.id }).catch(() => {});
    }

    return { customerRefund, transfer };
};

export const transferPendingRefund = async (refundId) => {
    const refund = await prisma.customerRefund.findUnique({
        where: { id: refundId },
        include: { customer: { include: { user: { select: { email: true } } } } },
    });

    if (!refund) throw new Error("Refund not found");
    if (refund.status !== "pending_connect") {
        logger.info(`[PaymentService] Refund ${refundId} is not pending_connect (status: ${refund.status}), skipping`);
        return refund;
    }
    if (refund.stripeTransferId) {
        logger.info(`[PaymentService] Refund ${refundId} already has transfer ${refund.stripeTransferId}, skipping`);
        return refund;
    }
    if (!refund.customer.stripeAccountId) throw new Error("Customer does not have a Connect account");

    const transfer = await stripe.transfers.create({
        amount: Math.round(parseFloat(refund.amount) * 100),
        currency: "usd",
        destination: refund.customer.stripeAccountId,
        metadata: { type: "customer_refund", customerRefundId: refund.id, bookingId: refund.bookingId, paymentId: refund.paymentId },
    }, { idempotencyKey: `customer-refund-${refund.id}` });

    const updated = await prisma.customerRefund.update({
        where: { id: refundId },
        data: { status: "transferred", stripeTransferId: transfer.id, transferredAt: new Date() },
    });

    logger.info("[PaymentService] Customer refund transferred", { refundId, amount: parseFloat(refund.amount), customerId: refund.customerId, transferId: transfer.id });

    sendCustomerRefundTransferred({ customer: refund.customer, refundAmount: parseFloat(refund.amount) }).catch(() => {});

    return updated;
};

export const processPendingRefundsForCustomer = async (customerId) => {
    const pendingRefunds = await prisma.customerRefund.findMany({ where: { customerId, status: "pending_connect" } });
    if (pendingRefunds.length === 0) return [];

    const settled = await Promise.allSettled(pendingRefunds.map((refund) => transferPendingRefund(refund.id)));

    return settled.map((result, i) => {
        const refund = pendingRefunds[i];
        if (result.status === "fulfilled") {
            return { refundId: refund.id, status: "transferred", transferId: result.value.stripeTransferId };
        }
        logger.error("[PaymentService] Failed to transfer pending refund", { refundId: refund.id, error: result.reason?.message });
        return { refundId: refund.id, status: "failed", error: result.reason?.message };
    });
};

export const handleCustomerPayoutFailed = async (customer, failureMessage) => {
    const transferredRefunds = await prisma.customerRefund.findMany({
        where: { customerId: customer.id, status: "transferred" },
        include: { customer: { include: { user: { select: { email: true } } } } },
    });

    if (transferredRefunds.length === 0) {
        logger.warn("[PaymentService] payout.failed for customer but no transferred refunds found", { customerId: customer.id });
        return;
    }

    const totalAmount = transferredRefunds.reduce((sum, r) => sum + parseFloat(r.amount), 0);

    await prisma.customerRefund.updateMany({
        where: { id: { in: transferredRefunds.map((r) => r.id) } },
        data: { status: "pending_connect", stripeTransferId: null, transferredAt: null, reason: failureMessage ?? "Bank transfer failed" },
    });

    logger.warn("[PaymentService] Customer payout failed — reverted refunds to pending_connect", { customerId: customer.id, refundCount: transferredRefunds.length, totalAmount, reason: failureMessage });

    sendCustomerRefundPayoutFailed({ customer: transferredRefunds[0].customer, refundAmount: parseFloat(totalAmount.toFixed(2)), reason: failureMessage }).catch(() => {});
};
