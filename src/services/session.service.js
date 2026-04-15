import { prisma } from "../config/prisma.js";
import { BadRequestError } from "../utils/errors.js";
import { logger } from "../config/logger.js";
import {
    sendSessionCompletionRequest,
    sendSessionConfirmed,
    sendSessionRevisionRequested,
    sendSessionRevisionSubmitted,
} from "./email.service.js";
import { logAction } from "./audit.service.js";
import { releaseSessionPayout, createPerSessionRefund } from "./payment.service.js";
import { findOrCreateDirectConversation, createSystemMessage } from "./message.service.js";

/**
 * Mark session as completed by therapist
 */
export const completeSessionByTherapist = async (sessionId, therapistId) => {
    const session = await prisma.session.findUnique({
        where: { id: sessionId },
        include: {
            booking: {
                include: {
                    customer: {
                        include: { user: { select: { id: true, email: true } } }
                    },
                    therapist: true
                },
            },
        },
    });

    if (!session) {
        throw new Error("Session not found");
    }

    if (session.booking.therapistId !== therapistId) {
        throw new Error("Unauthorized");
    }

    // Guard: therapist must have connected and completed Stripe onboarding
    const therapistProfile = session.booking.therapist;
    if (!therapistProfile.stripeAccountId || !therapistProfile.stripeOnboardingComplete) {
        throw new BadRequestError(
            "You must connect and complete your Stripe account setup before marking a session as complete.",
            "STRIPE_NOT_CONNECTED"
        );
    }

    if (session.status === "in_revision") {
        throw new BadRequestError(
            "This session has a pending revision request. Use the resubmit flow instead.",
            "SESSION_IN_REVISION"
        );
    }

    if (session.status !== "scheduled") {
        throw new Error("Session must be in scheduled status");
    }

    const updatedSession = await prisma.$transaction(async (tx) => {
        const updated = await tx.session.update({
            where: { id: sessionId },
            data: {
                status: "completed_by_therapist",
                completedAt: new Date(),
            },
        });

        if (session.booking.status === "confirmed") {
            await tx.booking.update({
                where: { id: session.bookingId },
                data: { status: "in_progress" },
            });
        }

        return updated;
    });

    // Event: session.completed_by_therapist
    logAction({
        actorId: session.booking.therapist.userId,
        action: "session.completed_by_therapist",
        entityType: "session",
        entityId: sessionId,
        changes: { bookingId: session.bookingId, completedAt: updatedSession.completedAt },
    });

    // System message: session_completed
    const completeTherapistUserId = session.booking.therapist.userId;
    const completeCustomerUserId = session.booking.customer.user.id;
    findOrCreateDirectConversation(completeTherapistUserId, completeCustomerUserId)
        .then((conversation) =>
            createSystemMessage({
                conversationId: conversation.id,
                actorId: completeTherapistUserId,
                recipientId: completeCustomerUserId,
                content: "Session marked complete by therapist. Please confirm within 3 days.",
                systemType: "session_completed",
                bookingId: session.bookingId,
            })
        )
        .catch((err) => {
            logger.error("[SessionService] System message (session_completed) failed", { error: err.message });
        });

    // Notify customer to confirm session (fire-and-forget)
    sendSessionCompletionRequest({
        customer: session.booking.customer,
        therapist: session.booking.therapist,
        session: updatedSession,
        booking: session.booking
    }).catch((err) => {
        logger.error('[SessionService] Completion request notification failed', { error: err.message });
    })

    return updatedSession;
}

/**
 * Confirm session completion by customer
 */
export const confirmSessionByCustomer = async (sessionId, customerId) => {
    const session = await prisma.session.findUnique({
        where: { id: sessionId },
        include: {
            booking: {
                include: {
                    therapist: {
                        include: { user: { select: { id: true, email: true } } }
                    },
                    customer: true,
                },
            },
        },
    });

    if (!session) {
        throw new Error("Session not found");
    }

    if (session.booking.customerId !== customerId) {
        throw new Error("Unauthorized");
    }

    // Idempotent: if already confirmed by customer, return as-is.
    if (session.status === "confirmed_by_customer") {
        return session;
    }

    // Block confirmation while a revision is pending — the customer must
    // wait for the therapist to resubmit before they can confirm.
    if (session.status === "in_revision") {
        throw new BadRequestError(
            "This session is awaiting therapist response to your revision request. You can confirm once they resubmit.",
            "SESSION_IN_REVISION"
        );
    }

    if (session.status !== "completed_by_therapist") {
        throw new Error("Therapist must complete session first");
    }

    const updatedSession = await prisma.$transaction(async (tx) => {
        const updated = await tx.session.update({
            where: { id: sessionId },
            data: {
                status: "confirmed_by_customer",
                confirmedByCustomerAt: new Date(),
            },
        });

        const allSessions = await tx.session.findMany({
            where: { bookingId: session.bookingId },
        });
        const totalSessions = allSessions.length;
        const confirmedCount = allSessions.filter(s =>
            s.id === sessionId || s.status === "confirmed_by_customer"
        ).length;

        if (confirmedCount === totalSessions) {
            await tx.booking.update({
                where: { id: session.bookingId },
                data: { status: "completed" },
            });
        }

        return { ...updated, _allConfirmed: confirmedCount === totalSessions, _confirmedCount: confirmedCount, _totalSessions: totalSessions };
    });

    // Event: session.confirmed_by_customer
    logAction({
        actorId: session.booking.customer.userId,
        action: "session.confirmed_by_customer",
        entityType: "session",
        entityId: sessionId,
        changes: {
            bookingId: session.bookingId,
            confirmedAt: updatedSession.confirmedByCustomerAt,
            sessionProgress: `${updatedSession._confirmedCount}/${updatedSession._totalSessions}`,
        },
    });

    // System message: session_confirmed
    const confirmTherapistUserId = session.booking.therapist.user.id;
    const confirmCustomerUserId = session.booking.customer.userId;
    const allDone = updatedSession._allConfirmed;
    findOrCreateDirectConversation(confirmCustomerUserId, confirmTherapistUserId)
        .then((conversation) =>
            createSystemMessage({
                conversationId: conversation.id,
                actorId: confirmCustomerUserId,
                recipientId: confirmTherapistUserId,
                content: allDone
                    ? `Session confirmed (${updatedSession._confirmedCount}/${updatedSession._totalSessions}). All sessions complete — final payout released.`
                    : `Session confirmed (${updatedSession._confirmedCount}/${updatedSession._totalSessions}). Payout released for this session.`,
                systemType: "session_confirmed",
                bookingId: session.bookingId,
            })
        )
        .catch((err) => {
            logger.error("[SessionService] System message (session_confirmed) failed", { error: err.message });
        });

    // Notify therapist that customer confirmed (fire-and-forget)
    sendSessionConfirmed({
        therapist: session.booking.therapist,
        customer: session.booking.customer,
        session: updatedSession,
        booking: session.booking
    }).catch((err) => {
        logger.error('[SessionService] Session confirmed notification failed', { error: err.message });
    });

    // Per-session payout: release the therapist's pro-rated share for THIS
    // session immediately. The last confirmed session gets the remainder so
    // the total across all SessionPayout rows equals payment.therapistPayout.
    try {
        const paymentRecord = await prisma.payment.findUnique({
            where: { bookingId: session.bookingId },
        });
        if (paymentRecord && ["escrowed", "partially_released"].includes(paymentRecord.status)) {
            const bookingWithTherapist = await prisma.booking.findUnique({
                where: { id: session.bookingId },
                include: { therapist: true },
            });
            await releaseSessionPayout({
                session: updatedSession,
                payment: paymentRecord,
                booking: bookingWithTherapist,
                isLast: updatedSession._allConfirmed,
            });
            logger.info("[Session] Per-session payout released", {
                bookingId: session.bookingId,
                sessionId,
                confirmed: updatedSession._confirmedCount,
                total: updatedSession._totalSessions,
                isLast: updatedSession._allConfirmed,
            });
        }
    } catch (err) {
        logger.error("[Session] Per-session payout failed", {
            bookingId: session.bookingId,
            sessionId,
            error: err.message,
        });
    }

    return updatedSession;
}

/**
 * Customer requests revision on a session the therapist marked complete.
 *
 * Pauses the auto-confirm cron implicitly by moving the session out of
 * `completed_by_therapist` — the cron's where clause filters on that exact
 * status, so once we're in `in_revision` the cron skips this row entirely.
 * No new timer state, no scheduled job to cancel.
 *
 * Per product decision: unlimited rounds, unlimited pause. revisionCount is
 * tracked for audit/analytics, not enforced.
 */
export const requestSessionRevision = async (sessionId, customerId, reason) => {
    if (!reason || typeof reason !== "string" || reason.trim().length < 10) {
        throw new BadRequestError(
            "Please describe what needs to change in at least 10 characters.",
            "REVISION_REASON_TOO_SHORT"
        );
    }

    const session = await prisma.session.findUnique({
        where: { id: sessionId },
        include: {
            booking: {
                include: {
                    customer: { include: { user: { select: { id: true, email: true } } } },
                    therapist: { include: { user: { select: { id: true, email: true } } } },
                },
            },
        },
    });

    if (!session) {
        throw new Error("Session not found");
    }

    if (session.booking.customerId !== customerId) {
        throw new Error("Unauthorized");
    }

    if (session.status !== "completed_by_therapist") {
        throw new BadRequestError(
            "You can only request a revision after the therapist marks the session complete.",
            "INVALID_SESSION_STATUS"
        );
    }

    const trimmedReason = reason.trim();

    const updatedSession = await prisma.session.update({
        where: { id: sessionId },
        data: {
            status: "in_revision",
            revisionRequestedAt: new Date(),
            revisionReason: trimmedReason,
            revisionCount: { increment: 1 },
            // Clear any prior revisionDueBy so the therapist sets a fresh one
            revisionDueBy: null,
        },
    });

    // Audit
    logAction({
        actorId: session.booking.customer.user.id,
        action: "session.revision_requested",
        entityType: "session",
        entityId: sessionId,
        changes: {
            bookingId: session.bookingId,
            revisionRound: updatedSession.revisionCount,
            reason: trimmedReason,
        },
    });

    // System message in the booking conversation — this is where the
    // therapist will see the request inline alongside any chat attachments
    // they've already shared with the customer.
    const customerUserId = session.booking.customer.user.id;
    const therapistUserId = session.booking.therapist.user.id;
    findOrCreateDirectConversation(customerUserId, therapistUserId)
        .then((conversation) =>
            createSystemMessage({
                conversationId: conversation.id,
                actorId: customerUserId,
                recipientId: therapistUserId,
                content: `Customer requested revision: "${trimmedReason}"`,
                systemType: "session_revision_requested",
                bookingId: session.bookingId,
            })
        )
        .catch((err) => {
            logger.error("[SessionService] System message (session_revision_requested) failed", { error: err.message });
        });

    // Notify therapist by email (fire-and-forget)
    sendSessionRevisionRequested({
        therapist: session.booking.therapist,
        customer: session.booking.customer,
        session: updatedSession,
        booking: session.booking,
        reason: trimmedReason,
    }).catch((err) => {
        logger.error("[SessionService] Revision requested email failed", { error: err.message });
    });

    return updatedSession;
};

/**
 * Step 1: Therapist acknowledges a revision request and commits to a due date.
 *
 * Status stays `in_revision` — the therapist is saying "I've seen your request
 * and I'll have it done by [date]." The customer sees the committed date and
 * knows when to check back.
 *
 * revisionDueBy is a soft commitment — shown in the UI but NOT enforced by
 * any cron. Per product decision: unlimited rounds, unlimited pause.
 */
export const respondToRevision = async (sessionId, therapistId, { dueBy }) => {
    if (!dueBy) {
        throw new BadRequestError(
            "Please set a date for when you'll have the revision ready.",
            "REVISION_DUE_BY_REQUIRED"
        );
    }

    const dueByDate = new Date(dueBy);
    if (Number.isNaN(dueByDate.getTime())) {
        throw new BadRequestError("Invalid date format.", "REVISION_DUE_BY_INVALID");
    }
    if (dueByDate <= new Date()) {
        throw new BadRequestError(
            "The committed date must be in the future.",
            "REVISION_DUE_BY_NOT_FUTURE"
        );
    }

    const session = await prisma.session.findUnique({
        where: { id: sessionId },
        include: {
            booking: {
                include: {
                    customer: { include: { user: { select: { id: true, email: true } } } },
                    therapist: { include: { user: { select: { id: true, email: true } } } },
                },
            },
        },
    });

    if (!session) {
        throw new Error("Session not found");
    }

    if (session.booking.therapistId !== therapistId) {
        throw new Error("Unauthorized");
    }

    if (session.status !== "in_revision") {
        throw new BadRequestError(
            "Only sessions in revision can be responded to.",
            "INVALID_SESSION_STATUS"
        );
    }

    const updatedSession = await prisma.session.update({
        where: { id: sessionId },
        data: {
            // Status stays in_revision — therapist is committing to a date, not resubmitting yet
            revisionDueBy: dueByDate,
        },
    });

    logAction({
        actorId: session.booking.therapist.user.id,
        action: "session.revision_responded",
        entityType: "session",
        entityId: sessionId,
        changes: {
            bookingId: session.bookingId,
            revisionRound: updatedSession.revisionCount,
            committedDueBy: dueByDate,
        },
    });

    // System message
    const therapistUserId = session.booking.therapist.user.id;
    const customerUserId = session.booking.customer.user.id;
    findOrCreateDirectConversation(therapistUserId, customerUserId)
        .then((conversation) =>
            createSystemMessage({
                conversationId: conversation.id,
                actorId: therapistUserId,
                recipientId: customerUserId,
                content: `Therapist acknowledged your revision request and will resubmit by ${dueByDate.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}.`,
                systemType: "session_revision_responded",
                bookingId: session.bookingId,
            })
        )
        .catch((err) => {
            logger.error("[SessionService] System message (session_revision_responded) failed", { error: err.message });
        });

    // Notify customer that therapist acknowledged
    sendSessionRevisionSubmitted({
        customer: session.booking.customer,
        therapist: session.booking.therapist,
        session: updatedSession,
        booking: session.booking,
    }).catch((err) => {
        logger.error("[SessionService] Revision responded email failed", { error: err.message });
    });

    return updatedSession;
};

/**
 * Step 2: Therapist resubmits the session after completing the revision work.
 *
 * Status changes to `completed_by_therapist`. completedAt is reset to NOW so
 * the autoConfirm cron starts a fresh 72h window for the customer to review.
 *
 * The therapist must have already responded (set revisionDueBy) before they
 * can resubmit. This enforces the two-step flow.
 */
export const resubmitSession = async (sessionId, therapistId) => {
    const session = await prisma.session.findUnique({
        where: { id: sessionId },
        include: {
            booking: {
                include: {
                    customer: { include: { user: { select: { id: true, email: true } } } },
                    therapist: { include: { user: { select: { id: true, email: true } } } },
                },
            },
        },
    });

    if (!session) {
        throw new Error("Session not found");
    }

    if (session.booking.therapistId !== therapistId) {
        throw new Error("Unauthorized");
    }

    if (session.status !== "in_revision") {
        throw new BadRequestError(
            "Only sessions in revision can be resubmitted.",
            "INVALID_SESSION_STATUS"
        );
    }

    if (!session.revisionDueBy) {
        throw new BadRequestError(
            "Please set a response date before resubmitting. Use 'Respond' to commit to a date first.",
            "REVISION_DUE_BY_NOT_SET"
        );
    }

    const now = new Date();

    const updatedSession = await prisma.session.update({
        where: { id: sessionId },
        data: {
            status: "completed_by_therapist",
            completedAt: now,
            revisionLastSubmittedAt: now,
        },
    });

    logAction({
        actorId: session.booking.therapist.user.id,
        action: "session.revision_resubmitted",
        entityType: "session",
        entityId: sessionId,
        changes: {
            bookingId: session.bookingId,
            revisionRound: updatedSession.revisionCount,
        },
    });

    // System message
    const therapistUserId = session.booking.therapist.user.id;
    const customerUserId = session.booking.customer.user.id;
    findOrCreateDirectConversation(therapistUserId, customerUserId)
        .then((conversation) =>
            createSystemMessage({
                conversationId: conversation.id,
                actorId: therapistUserId,
                recipientId: customerUserId,
                content: `Therapist has resubmitted the session. Please review and confirm.`,
                systemType: "session_revision_resubmitted",
                bookingId: session.bookingId,
            })
        )
        .catch((err) => {
            logger.error("[SessionService] System message (session_revision_resubmitted) failed", { error: err.message });
        });

    // Notify customer
    sendSessionRevisionSubmitted({
        customer: session.booking.customer,
        therapist: session.booking.therapist,
        session: updatedSession,
        booking: session.booking,
    }).catch((err) => {
        logger.error("[SessionService] Revision resubmitted email failed", { error: err.message });
    });

    return updatedSession;
};

/**
 * @deprecated Use respondToRevision + resubmitSession instead.
 * Kept for backward compat during the transition window.
 */
export const submitSessionRevision = async (sessionId, therapistId, { dueBy }) => {
    await respondToRevision(sessionId, therapistId, { dueBy });
    return resubmitSession(sessionId, therapistId);
};

/**
 * Cancel session
 */
export const cancelSession = async (sessionId, userId, reason) => {
    const session = await prisma.session.findUnique({
        where: { id: sessionId },
        include: {
            booking: {
                include: {
                    customer: true,
                    therapist: true,
                },
            },
        },
    });

    if (!session) {
        throw new Error("Session not found");
    }

    const isCustomer = session.booking.customer.userId === userId;
    const isTherapist = session.booking.therapist.userId === userId;

    if (!isCustomer && !isTherapist) {
        throw new Error("Unauthorized");
    }

    if (session.status === "confirmed_by_customer") {
        throw new Error("Cannot cancel confirmed session");
    }

    const updatedSession = await prisma.$transaction(async (tx) => {
        const updated = await tx.session.update({
            where: { id: sessionId },
            data: {
                status: "cancelled",
                cancellationReason: reason,
            },
        });

        await tx.booking.update({
            where: { id: session.bookingId },
            data: { status: "cancelled" },
        });

        return updated;
    });

    // Event: session.cancelled
    logAction({
        actorId: userId,
        action: isCustomer ? "session.cancelled_by_customer" : "session.cancelled_by_therapist",
        entityType: "session",
        entityId: sessionId,
        changes: { bookingId: session.bookingId, reason, cancelledBy: isCustomer ? "customer" : "therapist" },
    });

    return updatedSession;
}

/**
 * Mark a session as missed (no-show).
 *
 * Two actors can trigger this:
 *   - Therapist: self-reports they couldn't attend
 *   - Customer: reports therapist no-show (hard-blocked until scheduledDate has passed)
 *
 * Effect:
 *   - Session status -> "missed"
 *   - Per-session refund created (via createPerSessionRefund)
 *     - Immediate transfer if customer has verified Connect account
 *     - Otherwise pending_connect record (customer sees "Set Up Payout" CTA)
 *   - Customer receives refund notification email
 *   - Booking stays active — other sessions are unaffected
 *
 * Guards:
 *   - Session must be in "scheduled" status (cannot mark pending/completed/confirmed/missed/cancelled)
 *   - Only assigned therapist or booking customer can call this
 *   - Customer cannot mark a future session as missed (hard block on scheduledDate > NOW)
 *   - Reason is required (min 10 chars)
 *
 * @param {string} sessionId
 * @param {string} userId - authenticated user
 * @param {"therapist"|"customer"} actorRole
 * @param {string} reason
 * @returns {Promise<{session, customerRefund}>}
 */
export const markSessionMissed = async (sessionId, userId, actorRole, reason) => {
    if (!reason || reason.trim().length < 10) {
        throw new BadRequestError("A reason is required (at least 10 characters)");
    }

    const session = await prisma.session.findUnique({
        where: { id: sessionId },
        include: {
            booking: {
                include: {
                    customer: { include: { user: { select: { email: true } } } },
                    therapist: true,
                    payment: true,
                },
            },
        },
    });

    if (!session) {
        throw new BadRequestError("Session not found");
    }

    // Authorization: must be the assigned therapist or the booking customer
    const isTherapist = actorRole === "therapist" && session.booking.therapist.userId === userId;
    const isCustomer = actorRole === "customer" && session.booking.customer.userId === userId;

    if (!isTherapist && !isCustomer) {
        throw new BadRequestError("Unauthorized");
    }

    // Status guard — only scheduled sessions can be marked missed
    if (session.status !== "scheduled") {
        throw new BadRequestError(
            `Cannot mark session as missed from '${session.status}' status. Session must be scheduled.`
        );
    }

    // Timing hard block for customer — prevents reporting a future session as missed
    if (isCustomer && session.scheduledDate && new Date(session.scheduledDate) > new Date()) {
        throw new BadRequestError(
            "You can only report a missed visit after the scheduled date has passed."
        );
    }

    // Payment must exist and be in a state where a refund makes sense
    const payment = session.booking.payment;
    if (!payment) {
        throw new BadRequestError("No payment record found for this booking");
    }
    if (!["escrowed", "partially_released"].includes(payment.status)) {
        throw new BadRequestError(
            `Cannot refund a missed session — payment is in '${payment.status}' status.`
        );
    }

    const missedBy = isCustomer ? "customer" : "therapist";
    const refundReason = isCustomer ? "missed_visit_by_customer" : "missed_visit_by_therapist";

    // Update session status first — this prevents double-processing if the refund call is slow
    const updatedSession = await prisma.session.update({
        where: { id: sessionId },
        data: {
            status: "missed",
            missedBy,
            missedReason: reason.trim(),
            missedAt: new Date(),
        },
    });

    // Create the refund (transfer or pending)
    const { customerRefund } = await createPerSessionRefund({
        session: { id: session.id, bookingId: session.bookingId },
        payment: { id: payment.id, stripePaymentIntentId: payment.stripePaymentIntentId },
        customer: session.booking.customer,
        booking: {
            id: session.booking.id,
            rate: session.booking.rate,
            therapist: session.booking.therapist,
        },
        reason: refundReason,
    });

    logAction({
        actorId: userId,
        action: isCustomer ? "session.missed_by_customer" : "session.missed_by_therapist",
        entityType: "session",
        entityId: sessionId,
        changes: {
            bookingId: session.bookingId,
            reason: reason.trim(),
            refundAmount: parseFloat(session.booking.rate),
            refundStatus: customerRefund.status,
            customerRefundId: customerRefund.id,
        },
    });

    logger.info("[SessionService] Session marked as missed", {
        sessionId,
        missedBy,
        refundAmount: parseFloat(session.booking.rate),
        refundStatus: customerRefund.status,
    });

    return { session: updatedSession, customerRefund };
};

/**
 * Get session by ID
 */
export const getSessionById = async (sessionId, userId) => {
    const session = await prisma.session.findUnique({
        where: { id: sessionId },
        include: {
            booking: {
                include: {
                    customer: { include: { user: true } },
                    therapist: { include: { user: true } },
                    offer: {
                        include: {
                            request: true,
                        },
                    },
                    payment: true,
                },
            },
        },
    });

    if (!session) {
        throw new Error("Session not found");
    }

    const isCustomer = session.booking.customer.userId === userId;
    const isTherapist = session.booking.therapist.userId === userId;

    if (!isCustomer && !isTherapist) {
        throw new Error('Unauthorized');
    }

    return session;

}

/**
 * Get customer's sessions
 */
export const getCustomerSessions = async (customerId) => {
    const sessions = await prisma.session.findMany({
        where: { booking: { customerId } },
        include: {
            booking: {
                include: {
                    therapist: true,
                    offer: {
                        include: {
                            request: true,
                        },
                    },
                    payment: true,
                },
            },
        },
        orderBy: { scheduledDate: "desc" },
    });

    return sessions;
}

/**
 * Get therapist's session
 */
/**
 * Schedule a pending session (therapist sets date for a pending_schedule session)
 */
export const scheduleSession = async (sessionId, therapistId, scheduledDate) => {
    const session = await prisma.session.findUnique({
        where: { id: sessionId },
        include: {
            booking: {
                include: {
                    customer: { include: { user: { select: { id: true, email: true } } } },
                    therapist: true,
                },
            },
        },
    });

    if (!session) {
        throw new Error("Session not found");
    }

    if (session.booking.therapistId !== therapistId) {
        throw new Error("Unauthorized");
    }

    if (!["pending_schedule", "scheduled"].includes(session.status)) {
        throw new BadRequestError("Only pending or scheduled sessions can be scheduled/rescheduled");
    }

    // Validate date is in the future
    const proposedDate = new Date(scheduledDate);
    if (proposedDate <= new Date()) {
        throw new BadRequestError("Scheduled date must be in the future");
    }

    const updatedSession = await prisma.session.update({
        where: { id: sessionId },
        data: {
            scheduledDate: proposedDate,
            status: "scheduled",
        },
    });

    logAction({
        actorId: session.booking.therapist.userId,
        action: "session.scheduled",
        entityType: "session",
        entityId: sessionId,
        changes: {
            bookingId: session.bookingId,
            sessionNumber: session.sessionNumber,
            scheduledDate: proposedDate,
        },
    });

    logger.info("[Session] Session scheduled by therapist", {
        sessionId,
        sessionNumber: session.sessionNumber,
        bookingId: session.bookingId,
        scheduledDate: proposedDate,
    });

    return updatedSession;
};

export const getTherapistSessions = async (therapistId) => {
    const sessions = await prisma.session.findMany({
        where: {
            booking: { therapistId },
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
                    payment: true,
                },
            },
        },
        orderBy: { scheduledDate: 'desc' },
    });

    return sessions;
};