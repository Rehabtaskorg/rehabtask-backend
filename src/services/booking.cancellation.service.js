import { BOOKING_STATUS, SESSION_STATUS, USER_ROLES } from "../utils/constants.js";
import { prisma } from "../config/prisma.js";
import { stripe } from "../config/stripe.js";
import { NotFoundError, ConflictError, AuthorizationError } from "../utils/errors.js";
import { logger } from "../config/logger.js";
import { logAction } from "./audit.service.js";
import { createPerSessionRefund } from "./payment.service.js";
import {
    sendCancellationRequestedToTherapist,
    sendCancellationApprovedToCustomer,
    sendCancellationRejectedToCustomer,
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
        },
    });

/**
 * Customer requests cancellation of a booking.
 * If payment is intent_created (not yet captured), cancels immediately — no therapist gate needed.
 * If payment is escrowed, sets booking to CANCELLATION_REQUESTED and notifies the therapist.
 *
 * @param {string} bookingId
 * @param {string} userId - must be the customer's userId
 * @param {string} reason
 */
export const requestCancellation = async (bookingId, userId, reason) => {
    const booking = await getBookingForCancellation(bookingId);

    if (!booking?.payment) throw new NotFoundError("Booking or payment not found");
    if (booking.customer.userId !== userId) throw new AuthorizationError("You can only cancel your own bookings");

    const { payment, customer, therapist } = booking;

    if (!CANCELLABLE_PAYMENT_STATUSES.includes(payment.status)) {
        throw new ConflictError("This booking cannot be cancelled in its current state");
    }
    if (payment.stripeTransferId) {
        throw new ConflictError("Sessions have already been paid out. Please contact support to cancel.");
    }
    if (booking.status === BOOKING_STATUS.CANCELLATION_REQUESTED) {
        throw new ConflictError("A cancellation request is already pending for this booking");
    }

    // intent_created: no money captured — cancel immediately, skip therapist gate
    if (payment.status === "intent_created") {
        try {
            await stripe.paymentIntents.cancel(payment.stripePaymentIntentId, {
                cancellation_reason: "requested_by_customer",
            });
        } catch (err) {
            logger.warn("[CancellationService] PaymentIntent cancel failed", { bookingId, error: err.message });
        }

        await prisma.$transaction(async (tx) => {
            await tx.payment.update({ where: { id: payment.id }, data: { status: "failed" } });
            await tx.booking.update({ where: { id: bookingId }, data: { status: BOOKING_STATUS.CANCELLED, cancellationReason: reason } });
            if (booking.sessions?.length > 0) {
                await tx.session.updateMany({ where: { bookingId }, data: { status: SESSION_STATUS.CANCELLED, cancellationReason: reason } });
            }
        }, { timeout: 15000 });

        logAction({ actorId: userId, action: "booking.cancelled", entityType: "booking", entityId: bookingId, changes: { reason, method: "intent_cancelled" } });
        return { status: "cancelled", method: "intent_cancelled" };
    }

    // escrowed: set CANCELLATION_REQUESTED and notify therapist
    await prisma.booking.update({
        where: { id: bookingId },
        data: {
            status: BOOKING_STATUS.CANCELLATION_REQUESTED,
            cancellationReason: reason,
            cancellationRequestedAt: new Date(),
            preCancellationStatus: booking.status,
        },
    });

    sendCancellationRequestedToTherapist({ therapist, customer, booking, reason }).catch(logger.error);
    logAction({ actorId: userId, action: "booking.cancellation_requested", entityType: "booking", entityId: bookingId, changes: { reason, preCancellationStatus: booking.status } });

    return { status: "cancellation_requested" };
};

/**
 * Shared approval logic — used by both therapist approval and cron auto-approval.
 *
 * @param {string} bookingId
 * @param {{ isAuto?: boolean, actorId?: string }} opts
 */
const executeCancellationApproval = async (bookingId, { isAuto = false, actorId } = {}) => {
    const booking = await getBookingForCancellation(bookingId);
    if (!booking?.payment) throw new NotFoundError("Booking not found");
    if (booking.status !== BOOKING_STATUS.CANCELLATION_REQUESTED) throw new ConflictError("No pending cancellation request on this booking");

    const { payment, customer, therapist } = booking;
    const refundAmount = parseFloat(payment.amount);

    let refundResult = null;

    if (payment.status === "escrowed") {
        // Reuse createPerSessionRefund for consistent Connect transfer + pending_connect logic.
        // We pass a synthetic "session" with just an id since booking-level refunds have no session.
        refundResult = await createPerSessionRefund({
            session: { id: bookingId, bookingId },
            payment,
            customer,
            booking,
            reason: "booking_cancelled",
            amount: refundAmount,
        });
    }

    await prisma.$transaction(async (tx) => {
        await tx.payment.update({ where: { id: payment.id }, data: { status: "refunded", refundedAt: new Date() } });
        await tx.booking.update({
            where: { id: bookingId },
            data: {
                status: BOOKING_STATUS.CANCELLED,
                cancellationRequestedAt: null,
                preCancellationStatus: null,
            },
        });
        if (booking.sessions?.length > 0) {
            await tx.session.updateMany({
                where: { bookingId },
                data: { status: SESSION_STATUS.CANCELLED, cancellationReason: booking.cancellationReason },
            });
        }
    }, { timeout: 15000 });

    const emailFn = isAuto ? sendCancellationAutoApprovedToCustomer : sendCancellationApprovedToCustomer;
    emailFn({
        customer,
        therapist,
        booking,
        refundAmount,
        refundMethod: refundResult?.customerRefund?.status ?? "pending_connect",
    }).catch(logger.error);

    logAction({
        actorId: actorId ?? "system",
        action: isAuto ? "booking.cancellation_auto_approved" : "booking.cancellation_approved",
        entityType: "booking",
        entityId: bookingId,
        changes: { refundAmount, refundMethod: refundResult?.customerRefund?.status ?? "pending_connect" },
    });

    return { status: "cancelled", refundMethod: refundResult?.customerRefund?.status ?? "pending_connect" };
};

/**
 * Therapist approves a pending cancellation request.
 *
 * @param {string} bookingId
 * @param {string} userId - must be the therapist's userId
 */
export const approveCancellation = async (bookingId, userId) => {
    const booking = await prisma.booking.findUnique({
        where: { id: bookingId },
        select: { status: true, cancellationRequestedAt: true, therapist: { select: { userId: true } } },
    });
    if (!booking) throw new NotFoundError("Booking not found");
    if (booking.therapist.userId !== userId) throw new AuthorizationError("Only the assigned therapist can approve this cancellation");
    if (booking.status !== BOOKING_STATUS.CANCELLATION_REQUESTED) throw new ConflictError("No pending cancellation request on this booking");

    const hoursSinceRequest = (Date.now() - new Date(booking.cancellationRequestedAt).getTime()) / 3_600_000;
    if (hoursSinceRequest > 24) throw new ConflictError("The 24-hour approval window has passed. The cancellation has been auto-processed.");

    return executeCancellationApproval(bookingId, { actorId: userId });
};

/**
 * Therapist rejects a pending cancellation request.
 * Restores the booking to its pre-cancellation status.
 *
 * @param {string} bookingId
 * @param {string} userId - must be the therapist's userId
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
    if (booking.therapist.userId !== userId) throw new AuthorizationError("Only the assigned therapist can reject this cancellation");
    if (booking.status !== BOOKING_STATUS.CANCELLATION_REQUESTED) throw new ConflictError("No pending cancellation request on this booking");

    const restoredStatus = booking.preCancellationStatus ?? BOOKING_STATUS.CONFIRMED;

    await prisma.booking.update({
        where: { id: bookingId },
        data: {
            status: restoredStatus,
            cancellationReason: null,
            cancellationRequestedAt: null,
            preCancellationStatus: null,
        },
    });

    sendCancellationRejectedToCustomer({
        customer: booking.customer,
        therapist: booking.therapist,
        booking,
        rejectionReason,
    }).catch(logger.error);

    logAction({
        actorId: userId,
        action: "booking.cancellation_rejected",
        entityType: "booking",
        entityId: bookingId,
        changes: { rejectionReason, restoredStatus },
    });

    return { status: restoredStatus, rejectionReason };
};

/**
 * Admin override — approve or reject a pending cancellation, bypassing the 24h window.
 *
 * @param {string} bookingId
 * @param {"approve" | "reject"} action
 * @param {string} adminId
 * @param {string} [rejectionReason] - required when action is "reject"
 */
export const adminOverrideCancellation = async (bookingId, action, adminId, rejectionReason) => {
    const booking = await prisma.booking.findUnique({
        where: { id: bookingId },
        include: {
            therapist: { select: { userId: true, fullName: true, user: { select: { email: true } } } },
            customer: { select: { userId: true, fullName: true, user: { select: { email: true } } } },
        },
    });
    if (!booking) throw new NotFoundError("Booking not found");
    if (booking.status !== BOOKING_STATUS.CANCELLATION_REQUESTED) throw new ConflictError("No pending cancellation request on this booking");

    if (action === "approve") {
        return executeCancellationApproval(bookingId, { actorId: adminId });
    }

    if (action === "reject") {
        if (!rejectionReason?.trim()) throw new ConflictError("Rejection reason is required");
        const restoredStatus = booking.preCancellationStatus ?? BOOKING_STATUS.CONFIRMED;

        await prisma.booking.update({
            where: { id: bookingId },
            data: { status: restoredStatus, cancellationReason: null, cancellationRequestedAt: null, preCancellationStatus: null },
        });

        sendCancellationRejectedToCustomer({ customer: booking.customer, therapist: booking.therapist, booking, rejectionReason }).catch(logger.error);
        logAction({ actorId: adminId, action: "booking.cancellation_rejected_by_admin", entityType: "booking", entityId: bookingId, changes: { rejectionReason, restoredStatus } });

        return { status: restoredStatus, rejectionReason };
    }

    throw new ConflictError("Invalid action. Must be 'approve' or 'reject'");
};

/**
 * Cron job: auto-approve all cancellation requests older than 24 hours.
 * Called by the cancellation expiry cron on an hourly schedule.
 */
export const autoApproveStaleCancellations = async () => {
    const cutoff = new Date(Date.now() - 24 * 3_600_000);

    const stale = await prisma.booking.findMany({
        where: {
            status: BOOKING_STATUS.CANCELLATION_REQUESTED,
            cancellationRequestedAt: { lt: cutoff },
        },
        select: { id: true },
    });

    if (stale.length === 0) return { processed: 0 };

    logger.info(`[CancellationService] Auto-approving ${stale.length} stale cancellation request(s)`);

    const results = await Promise.allSettled(
        stale.map(({ id }) => executeCancellationApproval(id, { isAuto: true, actorId: "system" }))
    );

    const failed = results.filter(r => r.status === "rejected");
    if (failed.length > 0) {
        logger.error("[CancellationService] Some auto-approvals failed", { failed: failed.map(f => f.reason?.message) });
    }

    return { processed: stale.length, failed: failed.length };
};
