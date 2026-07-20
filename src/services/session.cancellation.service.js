import { SESSION_STATUS, BOOKING_STATUS, USER_ROLES } from "../utils/constants.js";
import { prisma } from "../config/prisma.js";
import { stripe } from "../config/stripe.js";
import { NotFoundError, ConflictError, AuthorizationError, BadRequestError } from "../utils/errors.js";
import { logger } from "../config/logger.js";
import { logAction } from "./audit.service.js";
import { createPerSessionRefund } from "./payment.service.js";
import { markLinkedRequestCompleted } from "./request.service.js";
import {
    sendSessionCancellationRequestedToOtherParty,
    sendSessionCancellationApprovedToRequester,
    sendSessionCancellationRejectedToRequester,
} from "./email.service.js";

const CANCELLABLE_STATUSES = [SESSION_STATUS.SCHEDULED, SESSION_STATUS.PENDING_SCHEDULE];
const TERMINAL_STATUSES = [
    SESSION_STATUS.CONFIRMED_BY_CUSTOMER,
    SESSION_STATUS.CANCELLED,
    SESSION_STATUS.MISSED,
    SESSION_STATUS.ATTEMPTED,
];

const getSessionForCancellation = (sessionId) =>
    prisma.session.findUnique({
        where: { id: sessionId },
        include: {
            booking: {
                include: {
                    customer: { include: { user: { select: { email: true } } } },
                    therapist: { include: { user: { select: { email: true } } } },
                    payment: true,
                },
            },
        },
    });

const finalizeBookingIfAllTerminal = async (bookingId, bookingStatus) => {
    const allSessions = await prisma.session.findMany({
        where: { bookingId },
        select: { status: true },
    });
    const allTerminal = allSessions.every((s) => TERMINAL_STATUSES.includes(s.status));
    if (allTerminal && [BOOKING_STATUS.CONFIRMED, BOOKING_STATUS.IN_PROGRESS, BOOKING_STATUS.ACCEPTED].includes(bookingStatus)) {
        await prisma.booking.update({ where: { id: bookingId }, data: { status: BOOKING_STATUS.FINALIZED } });
        return true;
    }
    return false;
};

/**
 * Request cancellation of a single session.
 * Either actor (customer or therapist) can initiate.
 * The *other* party must approve within 24h or it auto-approves.
 *
 * @param {string} sessionId
 * @param {string} userId
 * @param {string} actorRole - USER_ROLES.CUSTOMER | USER_ROLES.THERAPIST
 * @param {string} reason
 */
export const requestSessionCancellation = async (sessionId, userId, actorRole, reason) => {
    const session = await getSessionForCancellation(sessionId);
    if (!session) throw new NotFoundError("Session not found");

    const { booking } = session;
    const isCustomer = actorRole === USER_ROLES.CUSTOMER && booking.customer.userId === userId;
    const isTherapist = actorRole === USER_ROLES.THERAPIST && booking.therapist.userId === userId;
    if (!isCustomer && !isTherapist) throw new AuthorizationError("Unauthorized");

    if (!CANCELLABLE_STATUSES.includes(session.status)) {
        throw new ConflictError(`Session cannot be cancelled from '${session.status}' status`);
    }
    if (session.status === SESSION_STATUS.CANCELLATION_REQUESTED) {
        throw new ConflictError("A cancellation request is already pending for this session");
    }

    const payment = booking.payment;
    if (!payment || !["escrowed", "partially_released"].includes(payment.status)) {
        throw new BadRequestError("Payment is not in a refundable state");
    }

    const deadlineAt = new Date(Date.now() + 24 * 3_600_000);
    const deadlineStr = deadlineAt.toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

    await prisma.session.update({
        where: { id: sessionId },
        data: {
            status: SESSION_STATUS.CANCELLATION_REQUESTED,
            cancellationReason: reason,
            cancellationRequestedAt: new Date(),
            cancellationRequestedBy: actorRole,
            preCancellationStatus: session.status,
        },
    });

    const requester = isCustomer ? booking.customer : booking.therapist;
    const recipient = isCustomer ? booking.therapist : booking.customer;

    sendSessionCancellationRequestedToOtherParty({
        recipient, requester, session, booking, reason, deadlineStr,
    }).catch(logger.error);

    logAction({
        actorId: userId,
        action: "session.cancellation_requested",
        entityType: "session",
        entityId: sessionId,
        changes: { bookingId: booking.id, reason, requestedBy: actorRole },
    });

    return { status: SESSION_STATUS.CANCELLATION_REQUESTED };
};

/**
 * Shared approval logic — used by both manual approve and cron auto-approve.
 *
 * @param {string} sessionId
 * @param {{ isAuto?: boolean, actorId?: string }} opts
 */
const executeSessionCancellationApproval = async (sessionId, { isAuto = false, actorId } = {}) => {
    const session = await getSessionForCancellation(sessionId);
    if (!session) throw new NotFoundError("Session not found");
    if (session.status !== SESSION_STATUS.CANCELLATION_REQUESTED) {
        throw new ConflictError("No pending cancellation request on this session");
    }

    const { booking } = session;
    const payment = booking.payment;
    const refundAmount = parseFloat(booking.rate);

    await prisma.session.update({
        where: { id: sessionId },
        data: {
            status: SESSION_STATUS.CANCELLED,
            cancellationRequestedAt: null,
            cancellationRequestedBy: null,
            preCancellationStatus: null,
        },
    });

    const { customerRefund } = await createPerSessionRefund({
        session: { id: session.id, bookingId: session.bookingId },
        payment: { id: payment.id, stripePaymentIntentId: payment.stripePaymentIntentId },
        customer: booking.customer,
        booking: { id: booking.id, rate: booking.rate, therapist: booking.therapist },
        reason: "session_cancelled",
    });

    const bookingFinalized = await finalizeBookingIfAllTerminal(session.bookingId, booking.status);
    if (bookingFinalized) {
        markLinkedRequestCompleted(session.bookingId).catch((err) =>
            logger.error("[SessionCancellationService] markLinkedRequestCompleted failed after cancellation FINALIZED", { bookingId: session.bookingId, error: err.message })
        );
    }

    const requester = session.cancellationRequestedBy === USER_ROLES.CUSTOMER
        ? booking.customer
        : booking.therapist;

    sendSessionCancellationApprovedToRequester({
        requester,
        session,
        refundAmount,
        refundMethod: customerRefund.status,
    }).catch(logger.error);

    logAction({
        actorId: actorId ?? "system",
        action: isAuto ? "session.cancellation_auto_approved" : "session.cancellation_approved",
        entityType: "session",
        entityId: sessionId,
        changes: { bookingId: booking.id, refundAmount, refundStatus: customerRefund.status, bookingFinalized },
    });

    return { status: SESSION_STATUS.CANCELLED, refundMethod: customerRefund.status, bookingFinalized };
};

/**
 * The other party approves a pending session cancellation request.
 *
 * @param {string} sessionId
 * @param {string} userId
 * @param {string} actorRole
 */
export const approveSessionCancellation = async (sessionId, userId, actorRole) => {
    const session = await prisma.session.findUnique({
        where: { id: sessionId },
        select: {
            status: true,
            cancellationRequestedAt: true,
            cancellationRequestedBy: true,
            booking: {
                select: {
                    customer: { select: { userId: true } },
                    therapist: { select: { userId: true } },
                },
            },
        },
    });
    if (!session) throw new NotFoundError("Session not found");
    if (session.status !== SESSION_STATUS.CANCELLATION_REQUESTED) {
        throw new ConflictError("No pending cancellation request on this session");
    }

    const isCustomer = actorRole === USER_ROLES.CUSTOMER && session.booking.customer.userId === userId;
    const isTherapist = actorRole === USER_ROLES.THERAPIST && session.booking.therapist.userId === userId;
    if (!isCustomer && !isTherapist) throw new AuthorizationError("Unauthorized");

    if (actorRole === session.cancellationRequestedBy) {
        throw new ConflictError("You cannot approve your own cancellation request");
    }

    const hoursSinceRequest = (Date.now() - new Date(session.cancellationRequestedAt).getTime()) / 3_600_000;
    if (hoursSinceRequest > 24) {
        throw new ConflictError("The 24-hour approval window has passed. The cancellation has been auto-processed.");
    }

    return executeSessionCancellationApproval(sessionId, { actorId: userId });
};

/**
 * The other party rejects a pending session cancellation request.
 * Restores session to its pre-cancellation status.
 *
 * @param {string} sessionId
 * @param {string} userId
 * @param {string} actorRole
 * @param {string} rejectionReason
 */
export const rejectSessionCancellation = async (sessionId, userId, actorRole, rejectionReason) => {
    const session = await getSessionForCancellation(sessionId);
    if (!session) throw new NotFoundError("Session not found");
    if (session.status !== SESSION_STATUS.CANCELLATION_REQUESTED) {
        throw new ConflictError("No pending cancellation request on this session");
    }

    const { booking } = session;
    const isCustomer = actorRole === USER_ROLES.CUSTOMER && booking.customer.userId === userId;
    const isTherapist = actorRole === USER_ROLES.THERAPIST && booking.therapist.userId === userId;
    if (!isCustomer && !isTherapist) throw new AuthorizationError("Unauthorized");

    if (actorRole === session.cancellationRequestedBy) {
        throw new ConflictError("You cannot reject your own cancellation request");
    }

    const restoredStatus = session.preCancellationStatus ?? SESSION_STATUS.SCHEDULED;

    await prisma.session.update({
        where: { id: sessionId },
        data: {
            status: restoredStatus,
            cancellationReason: null,
            cancellationRequestedAt: null,
            cancellationRequestedBy: null,
            preCancellationStatus: null,
        },
    });

    const requester = session.cancellationRequestedBy === USER_ROLES.CUSTOMER
        ? booking.customer
        : booking.therapist;

    sendSessionCancellationRejectedToRequester({ requester, session, rejectionReason }).catch(logger.error);

    logAction({
        actorId: userId,
        action: "session.cancellation_rejected",
        entityType: "session",
        entityId: sessionId,
        changes: { bookingId: booking.id, rejectionReason, restoredStatus },
    });

    return { status: restoredStatus, rejectionReason };
};

/**
 * Cron: auto-approve session cancellation requests older than 24h.
 */
export const autoApproveStaleSessionCancellations = async () => {
    const cutoff = new Date(Date.now() - 24 * 3_600_000);
    const stale = await prisma.session.findMany({
        where: { status: SESSION_STATUS.CANCELLATION_REQUESTED, cancellationRequestedAt: { lt: cutoff } },
        select: { id: true },
    });

    if (stale.length === 0) return { processed: 0 };

    logger.info(`[SessionCancellationService] Auto-approving ${stale.length} stale session cancellation request(s)`);

    const results = await Promise.allSettled(
        stale.map(({ id }) => executeSessionCancellationApproval(id, { isAuto: true, actorId: "system" }))
    );

    const failed = results.filter((r) => r.status === "rejected");
    if (failed.length > 0) {
        logger.error("[SessionCancellationService] Some auto-approvals failed", {
            failed: failed.map((f) => f.reason?.message),
        });
    }

    return { processed: stale.length, failed: failed.length };
};
