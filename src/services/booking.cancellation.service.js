import { BOOKING_STATUS, SESSION_STATUS, USER_ROLES } from "../utils/constants.js";
import { prisma } from "../config/prisma.js";
import { stripe } from "../config/stripe.js";
import { NotFoundError, ConflictError, AuthorizationError } from "../utils/errors.js";
import { logger } from "../config/logger.js";
import { logAction } from "./audit.service.js";
import {
    sendCancellationRequestedToTherapist,
    sendCancellationRequestedToCustomer,
    sendCancellationApprovedToCustomer,
    sendCancellationApprovedToTherapist,
    sendCancellationRejectedToCustomer,
    sendCancellationRejectedToTherapist,
    sendCancellationAutoApprovedToCustomer,
} from "./email.service.js";

const CANCELLABLE_PAYMENT_STATUSES = ["escrowed", "intent_created"];

/** @returns {Promise<import("@prisma/client").Booking>} */
const getBookingForCancellation = async (bookingId) =>
    prisma.booking.findUnique({
        where: { id: bookingId },
        include: {
            payment: true,
            sessions: { orderBy: { sessionNumber: "asc" } },
            customer: {
                select: {
                    id: true,
                    userId: true,
                    fullName: true,
                    customerType: true,
                    agencyName: true,
                    stripeAccountId: true,
                    stripeOnboardingComplete: true,
                    user: { select: { email: true } },
                },
            },
            therapist: {
                select: {
                    id: true,
                    userId: true,
                    fullName: true,
                    user: { select: { email: true } },
                },
            },
            patient: { select: { id: true, fullName: true } },
        },
    });

/**
 * Either party requests cancellation of a booking.
 * If payment is intent_created (not yet captured), cancels immediately — no approval gate needed.
 * If payment is escrowed, sets booking to CANCELLATION_REQUESTED and notifies the other party,
 * who has 24 hours to approve or reject.
 *
 * @param {string} bookingId
 * @param {string} userId - the requesting user's id
 * @param {string} reason
 */
export const requestCancellation = async (bookingId, userId, reason) => {
    const booking = await getBookingForCancellation(bookingId);

    if (!booking?.payment) throw new NotFoundError("Booking or payment not found");

    const { payment, customer, therapist } = booking;
    const isCustomer = customer.userId === userId;
    const isTherapist = therapist.userId === userId;
    if (!isCustomer && !isTherapist) throw new AuthorizationError("You can only cancel your own bookings");

    if (!CANCELLABLE_PAYMENT_STATUSES.includes(payment.status)) {
        throw new ConflictError("This booking cannot be cancelled in its current state");
    }
    if (payment.stripeTransferId) {
        throw new ConflictError("Sessions have already been paid out. Please contact support to cancel.");
    }
    if (booking.status === BOOKING_STATUS.CANCELLATION_REQUESTED) {
        throw new ConflictError("A cancellation request is already pending for this booking");
    }

    // intent_created: no money captured — cancel immediately, skip approval gate
    if (payment.status === "intent_created") {
        try {
            await stripe.paymentIntents.cancel(payment.stripePaymentIntentId, {
                cancellation_reason: "requested_by_customer",
            });
        } catch (err) {
            logger.warn("[CancellationService] PaymentIntent cancel failed", { bookingId, error: err.message });
        }

        const nonCancelledSessionCount = booking.sessions?.filter(
            (s) => s.status !== SESSION_STATUS.CANCELLED
        ).length ?? 0;

        await prisma.$transaction(async (tx) => {
            await tx.payment.update({ where: { id: payment.id }, data: { status: "failed" } });
            await tx.booking.update({ where: { id: bookingId }, data: { status: BOOKING_STATUS.CANCELLED, cancellationReason: reason } });
            if (booking.sessions?.length > 0) {
                await tx.session.updateMany({ where: { bookingId }, data: { status: SESSION_STATUS.CANCELLED, cancellationReason: reason } });
            }
            if (nonCancelledSessionCount > 0) {
                await tx.subscription.updateMany({
                    where: {
                        customerId: booking.customer.id,
                        status: { in: ["active", "trialing", "grace_period", "past_due"] },
                        sessionsUsed: { gte: nonCancelledSessionCount },
                    },
                    data: { sessionsUsed: { decrement: nonCancelledSessionCount } },
                });
            }
        }, { timeout: 15000 });

        logAction({ actorId: userId, action: "booking.cancelled", entityType: "booking", entityId: bookingId, changes: { reason, method: "intent_cancelled" } });
        return { status: "cancelled", method: "intent_cancelled" };
    }

    // escrowed: set CANCELLATION_REQUESTED and notify the other party
    const requestedBy = isCustomer ? USER_ROLES.CUSTOMER : USER_ROLES.THERAPIST;

    await prisma.booking.update({
        where: { id: bookingId },
        data: {
            status: BOOKING_STATUS.CANCELLATION_REQUESTED,
            cancellationReason: reason,
            cancellationRequestedAt: new Date(),
            cancellationRequestedBy: requestedBy,
            preCancellationStatus: booking.status,
        },
    });

    if (requestedBy === USER_ROLES.CUSTOMER) {
        sendCancellationRequestedToTherapist({ therapist, customer, booking, reason }).catch(logger.error);
    } else {
        sendCancellationRequestedToCustomer({ therapist, customer, booking, reason }).catch(logger.error);
    }

    logAction({ actorId: userId, action: "booking.cancellation_requested", entityType: "booking", entityId: bookingId, changes: { reason, requestedBy, preCancellationStatus: booking.status } });

    return { status: "cancellation_requested" };
};

/**
 * Shared approval logic — used by manual approval and cron auto-approval.
 * Exported for use by bookingCancellationExpiry.service.js.
 *
 * @param {string} bookingId
 * @param {{ isAuto?: boolean, actorId?: string }} opts
 */
export const executeCancellationApproval = async (bookingId, { isAuto = false, actorId } = {}) => {
    const booking = await getBookingForCancellation(bookingId);
    if (!booking?.payment) throw new NotFoundError("Booking not found");
    if (booking.status !== BOOKING_STATUS.CANCELLATION_REQUESTED) throw new ConflictError("No pending cancellation request on this booking");

    const { payment, customer, therapist } = booking;
    const refundAmount = parseFloat(payment.amount);

    let refundResult = null;

    if (payment.status === "escrowed") {
        let stripeTransfer = null;
        if (customer.stripeAccountId && customer.stripeOnboardingComplete) {
            try {
                stripeTransfer = await stripe.transfers.create({
                    amount: Math.round(refundAmount * 100),
                    currency: "usd",
                    destination: customer.stripeAccountId,
                    metadata: {
                        type: "customer_refund",
                        reason: "booking_cancelled",
                        bookingId: booking.id,
                        paymentId: payment.id,
                    },
                }, { idempotencyKey: `cancellation-refund-${booking.id}` });
            } catch (err) {
                logger.error("[CancellationService] Connect transfer failed — creating pending_connect record", { bookingId, error: err.message });
            }
        }

        const customerRefund = await prisma.customerRefund.create({
            data: {
                customerId: customer.id,
                paymentId: payment.id,
                bookingId: booking.id,
                amount: refundAmount,
                reason: "booking_cancelled",
                status: stripeTransfer ? "transferred" : "pending_connect",
                stripeTransferId: stripeTransfer?.id ?? null,
                transferredAt: stripeTransfer ? new Date() : null,
            },
        });

        refundResult = { customerRefund, transfer: stripeTransfer };
    }

    const nonCancelledCount = booking.sessions?.filter(
        (s) => s.status !== SESSION_STATUS.CANCELLED
    ).length ?? 0;

    await prisma.$transaction(async (tx) => {
        await tx.payment.update({ where: { id: payment.id }, data: { status: "refunded", refundedAt: new Date(), refundedAmount: refundAmount } });
        await tx.booking.update({
            where: { id: bookingId },
            data: {
                status: BOOKING_STATUS.CANCELLED,
                cancellationRequestedAt: null,
                cancellationRequestedBy: null,
                preCancellationStatus: null,
            },
        });
        if (booking.sessions?.length > 0) {
            await tx.session.updateMany({
                where: { bookingId },
                data: { status: SESSION_STATUS.CANCELLED, cancellationReason: booking.cancellationReason },
            });
        }
        if (nonCancelledCount > 0) {
            await tx.subscription.updateMany({
                where: {
                    customerId: booking.customer.id,
                    status: { in: ["active", "trialing", "grace_period", "past_due"] },
                    sessionsUsed: { gte: nonCancelledCount },
                },
                data: { sessionsUsed: { decrement: nonCancelledCount } },
            });
        }
    }, { timeout: 15000 });

    const refundMethod = refundResult?.customerRefund?.status ?? "pending_connect";

    if (booking.cancellationRequestedBy === USER_ROLES.THERAPIST) {
        // Therapist requested, customer approved — refund still goes to the customer
        sendCancellationApprovedToCustomer({ customer, therapist, booking, refundAmount, refundMethod }).catch(logger.error);
        sendCancellationApprovedToTherapist({ customer, therapist, booking, refundAmount }).catch(logger.error);
    } else {
        const emailFn = isAuto ? sendCancellationAutoApprovedToCustomer : sendCancellationApprovedToCustomer;
        emailFn({ customer, therapist, booking, refundAmount, refundMethod }).catch(logger.error);
    }

    logAction({
        actorId: actorId ?? "system",
        action: isAuto ? "booking.cancellation_auto_approved" : "booking.cancellation_approved",
        entityType: "booking",
        entityId: bookingId,
        changes: { refundAmount, refundMethod, requestedBy: booking.cancellationRequestedBy },
    });

    return { status: "cancelled", refundMethod };
};

/**
 * The other party approves a pending cancellation request.
 * If the customer requested, the therapist approves; if the therapist requested, the customer approves.
 *
 * @param {string} bookingId
 * @param {string} userId
 */
export const approveCancellation = async (bookingId, userId) => {
    const booking = await prisma.booking.findUnique({
        where: { id: bookingId },
        select: {
            status: true,
            cancellationRequestedAt: true,
            cancellationRequestedBy: true,
            customer: { select: { userId: true } },
            therapist: { select: { userId: true } },
        },
    });
    if (!booking) throw new NotFoundError("Booking not found");
    if (booking.status !== BOOKING_STATUS.CANCELLATION_REQUESTED) throw new ConflictError("No pending cancellation request on this booking");

    const isCustomer = booking.customer.userId === userId;
    const isTherapist = booking.therapist.userId === userId;
    if (!isCustomer && !isTherapist) throw new AuthorizationError("Unauthorized");

    const approverRole = isCustomer ? USER_ROLES.CUSTOMER : USER_ROLES.THERAPIST;
    if (approverRole === booking.cancellationRequestedBy) {
        throw new ConflictError("You cannot approve your own cancellation request");
    }

    const hoursSinceRequest = (Date.now() - new Date(booking.cancellationRequestedAt).getTime()) / 3_600_000;
    if (hoursSinceRequest > 24) throw new ConflictError("The 24-hour approval window has passed. The cancellation has been auto-processed.");

    return executeCancellationApproval(bookingId, { actorId: userId });
};

/**
 * The other party rejects a pending cancellation request.
 * Restores the booking to its pre-cancellation status.
 *
 * @param {string} bookingId
 * @param {string} userId
 * @param {string} rejectionReason
 */
export const rejectCancellation = async (bookingId, userId, rejectionReason) => {
    const booking = await prisma.booking.findUnique({
        where: { id: bookingId },
        include: {
            therapist: { select: { userId: true, fullName: true, user: { select: { email: true } } } },
            customer: { select: { userId: true, fullName: true, user: { select: { email: true } } } },
        },
    });
    if (!booking) throw new NotFoundError("Booking not found");
    if (booking.status !== BOOKING_STATUS.CANCELLATION_REQUESTED) throw new ConflictError("No pending cancellation request on this booking");

    const isCustomer = booking.customer.userId === userId;
    const isTherapist = booking.therapist.userId === userId;
    if (!isCustomer && !isTherapist) throw new AuthorizationError("Unauthorized");

    const rejectorRole = isCustomer ? USER_ROLES.CUSTOMER : USER_ROLES.THERAPIST;
    if (rejectorRole === booking.cancellationRequestedBy) {
        throw new ConflictError("You cannot reject your own cancellation request");
    }

    const restoredStatus = booking.preCancellationStatus ?? BOOKING_STATUS.CONFIRMED;

    await prisma.booking.update({
        where: { id: bookingId },
        data: {
            status: restoredStatus,
            cancellationReason: null,
            cancellationRequestedAt: null,
            cancellationRequestedBy: null,
            preCancellationStatus: null,
        },
    });

    if (booking.cancellationRequestedBy === USER_ROLES.THERAPIST) {
        sendCancellationRejectedToTherapist({ customer: booking.customer, therapist: booking.therapist, booking, rejectionReason }).catch(logger.error);
    } else {
        sendCancellationRejectedToCustomer({ customer: booking.customer, therapist: booking.therapist, booking, rejectionReason }).catch(logger.error);
    }

    logAction({
        actorId: userId,
        action: "booking.cancellation_rejected",
        entityType: "booking",
        entityId: bookingId,
        changes: { rejectionReason, restoredStatus, requestedBy: booking.cancellationRequestedBy },
    });

    return { status: restoredStatus, rejectionReason };
};