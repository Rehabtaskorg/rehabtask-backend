import { SESSION_STATUS, BOOKING_STATUS, USER_ROLES, REVISION_EXTEND_DAYS, MAX_VISIT_TITLE_LENGTH } from "../utils/constants.js";
import { THERAPIST_SAFE_SELECT, CUSTOMER_SAFE_SELECT, therapistSelectFor, hasContactAccessByProfileId } from "../utils/therapistContactAccess.js";
import { prisma } from "../config/prisma.js";
import { BadRequestError } from "../utils/errors.js";
import { logger } from "../config/logger.js";
import {
    sendSessionCompletionRequest,
    sendSessionConfirmed,
    sendSessionRevisionRequested,
    sendSessionRevisionSubmitted,
} from "./email.service.js";
import { smsCustWorkSubmittedForReview, smsTherPaymentReleased, smsTherRevisionRequested, smsCustRevisionExtended } from "./sms.service.js";
import { logAction } from "./audit.service.js";
import {
    releaseSessionPayout,
    releasePartialSessionPayout,
    createPerSessionRefund,
} from "./payment.service.js";
import {
    sendAttemptedVisitTherapistPayout,
} from "./email.service.js";
import { findOrCreateDirectConversation, createSystemMessage } from "./message.service.js";
import { markLinkedRequestCompleted } from "./request.service.js";

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

    if (session.status !== SESSION_STATUS.SCHEDULED) {
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
                data: { status: BOOKING_STATUS.IN_PROGRESS },
            });
        }

        return updated;
    }, { timeout: 10000 });

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
    findOrCreateDirectConversation(completeTherapistUserId, completeCustomerUserId, session.booking.patientId || null)
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
    });
    smsCustWorkSubmittedForReview(session.booking.customer, session.booking.id);

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
                    therapist: { select: { ...THERAPIST_SAFE_SELECT, user: { select: { id: true, email: true } } } },
                    customer: { select: CUSTOMER_SAFE_SELECT },
                    patient: { select: { id: true, fullName: true } },
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
    if (session.status === SESSION_STATUS.CONFIRMED_BY_CUSTOMER) {
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
                status: SESSION_STATUS.CONFIRMED_BY_CUSTOMER,
                confirmedByCustomerAt: new Date(),
            },
        });

        const allSessions = await tx.session.findMany({
            where: { bookingId: session.bookingId },
        });
        const totalSessions = allSessions.length;
        const confirmedCount = allSessions.filter(s =>
            s.id === sessionId ||
            s.status === SESSION_STATUS.CONFIRMED_BY_CUSTOMER ||
            s.status === SESSION_STATUS.ATTEMPTED ||
            s.status === SESSION_STATUS.MISSED ||
            s.status === SESSION_STATUS.CANCELLED
        ).length;

        if (confirmedCount === totalSessions) {
            await tx.booking.update({
                where: { id: session.bookingId },
                data: { status: BOOKING_STATUS.COMPLETED },
            });
        }

        return { ...updated, _allConfirmed: confirmedCount === totalSessions, _confirmedCount: confirmedCount, _totalSessions: totalSessions };
    }, { timeout: 10000 });

    if (updatedSession._allConfirmed) {
        markLinkedRequestCompleted(session.bookingId).catch((err) =>
            logger.error("[SessionService] markLinkedRequestCompleted failed after COMPLETED", { bookingId: session.bookingId, error: err.message })
        );
    }

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
    findOrCreateDirectConversation(confirmCustomerUserId, confirmTherapistUserId, session.booking.patientId || null)
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
            smsTherPaymentReleased(bookingWithTherapist.therapist);
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
    findOrCreateDirectConversation(customerUserId, therapistUserId, session.booking.patientId || null)
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

    smsTherRevisionRequested(session.booking.therapist, session.bookingId);

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
    findOrCreateDirectConversation(therapistUserId, customerUserId, session.booking.patientId || null)
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
            revisionExpirySmsSentAt: null,
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
    findOrCreateDirectConversation(therapistUserId, customerUserId, session.booking.patientId || null)
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
 * Therapist extends the revision deadline by REVISION_EXTEND_DAYS days.
 *
 * New deadline = max(currentRevisionDueBy, now) + REVISION_EXTEND_DAYS days.
 * This ensures the deadline always moves forward regardless of when the
 * therapist clicks — early extenders get more buffer, last-second extenders
 * get the same buffer as if they had no prior deadline.
 * Can be called unlimited times while the session is in_revision.
 *
 * @param {string} sessionId
 * @param {string} therapistId
 */
export const extendRevision = async (sessionId, therapistId) => {
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

    if (!session) throw new Error("Session not found");
    if (session.booking.therapistId !== therapistId) throw new Error("Unauthorized");
    if (session.status !== "in_revision") {
        throw new BadRequestError(
            "Only sessions in revision can be extended.",
            "INVALID_SESSION_STATUS"
        );
    }

    const base = session.revisionDueBy && session.revisionDueBy > new Date()
        ? session.revisionDueBy
        : new Date();
    const newDueBy = new Date(base.getTime() + REVISION_EXTEND_DAYS * 24 * 60 * 60 * 1000);

    const updatedSession = await prisma.session.update({
        where: { id: sessionId },
        data: { revisionDueBy: newDueBy },
    });

    logAction({
        actorId: session.booking.therapist.user.id,
        action: "session.revision_extended",
        entityType: "session",
        entityId: sessionId,
        changes: {
            bookingId: session.bookingId,
            revisionRound: session.revisionCount,
            newDueBy,
            extendedByDays: REVISION_EXTEND_DAYS,
        },
    });

    const therapistUserId = session.booking.therapist.user.id;
    const customerUserId = session.booking.customer.user.id;
    findOrCreateDirectConversation(therapistUserId, customerUserId, session.booking.patientId || null)
        .then((conversation) =>
            createSystemMessage({
                conversationId: conversation.id,
                actorId: therapistUserId,
                recipientId: customerUserId,
                content: `Therapist extended the revision deadline to ${newDueBy.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}.`,
                systemType: "session_revision_extended",
                bookingId: session.bookingId,
            })
        )
        .catch((err) => {
            logger.error("[SessionService] System message (session_revision_extended) failed", { error: err.message });
        });

    smsCustRevisionExtended(session.booking.customer, session.bookingId, newDueBy);

    return updatedSession;
};

/**
 * Cancel session
 */
export const cancelSession = async (sessionId, userId, actorRole, reason) => {
    const { requestSessionCancellation } = await import("./session.cancellation.service.js");
    return requestSessionCancellation(sessionId, userId, actorRole, reason);
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
    const isTherapist = actorRole === USER_ROLES.THERAPIST && session.booking.therapist.userId === userId;
    const isCustomer = actorRole === USER_ROLES.CUSTOMER && session.booking.customer.userId === userId;

    if (!isTherapist && !isCustomer) {
        throw new BadRequestError("Unauthorized");
    }

    // Status guard — only scheduled sessions can be marked missed
    if (session.status !== SESSION_STATUS.SCHEDULED) {
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

    const missedBy = isCustomer ? USER_ROLES.CUSTOMER : USER_ROLES.THERAPIST;
    const refundReason = isCustomer ? "missed_visit_by_customer" : "missed_visit_by_therapist";

    // Update session status first — this prevents double-processing if the refund call is slow
    const updatedSession = await prisma.session.update({
        where: { id: sessionId },
        data: {
            status: SESSION_STATUS.MISSED,
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

    const refreshedSessions = await prisma.session.findMany({
        where: { bookingId: session.bookingId },
        select: { id: true, status: true },
    });
    const anyOpenSession = refreshedSessions.some((s) =>
        ![SESSION_STATUS.CONFIRMED_BY_CUSTOMER, SESSION_STATUS.CANCELLED, SESSION_STATUS.MISSED, SESSION_STATUS.ATTEMPTED].includes(s.status)
    );

    let bookingFinalized = false;
    if (!anyOpenSession && [BOOKING_STATUS.CONFIRMED, BOOKING_STATUS.IN_PROGRESS, BOOKING_STATUS.ACCEPTED].includes(session.booking.status)) {
        await prisma.booking.update({
            where: { id: session.bookingId },
            data: { status: BOOKING_STATUS.FINALIZED },
        });
        bookingFinalized = true;
        markLinkedRequestCompleted(session.bookingId).catch((err) =>
            logger.error("[SessionService] markLinkedRequestCompleted failed after missed FINALIZED", { bookingId: session.bookingId, error: err.message })
        );
    }

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
            bookingFinalized,
        },
    });

    logger.info("[SessionService] Session marked as missed", {
        sessionId,
        missedBy,
        refundAmount: parseFloat(session.booking.rate),
        refundStatus: customerRefund.status,
        bookingFinalized,
    });

    return { session: updatedSession, customerRefund, bookingFinalized };
};

/**
 * Mark a session as an attempted visit — therapist arrived but patient wasn't home.
 *
 * Money flow (draws from escrow, no new card charge):
 *   - Therapist receives the booking's snapshot attempted-visit rate (minus commission)
 *   - Customer is refunded the remainder (booking.rate - attemptedVisitRate)
 *   - Session closes in terminal 'attempted' status
 *
 * Guards:
 *   - Therapist-only (customer cannot mark — they'd go through Resolution Center instead)
 *   - Session must be 'scheduled'
 *   - scheduledDate must have passed (timing block)
 *   - booking.attemptedVisitRate must be set AND > 0
 *   - Reason required (min 10 chars)
 *   - Payment must be escrowed or partially_released
 *
 * @param {string} sessionId
 * @param {string} userId - authenticated therapist user
 * @param {string} reason - min 10 chars
 * @returns {Promise<{session, customerRefund, sessionPayout, bookingFinalized}>}
 */
export const markSessionAttempted = async (sessionId, userId, reason) => {
    if (!reason || reason.trim().length < 10) {
        throw new BadRequestError("A reason is required (at least 10 characters)");
    }

    const session = await prisma.session.findUnique({
        where: { id: sessionId },
        include: {
            booking: {
                include: {
                    customer: { include: { user: { select: { email: true } } } },
                    therapist: { include: { user: { select: { email: true } } } },
                    payment: true,
                    sessions: { select: { id: true, status: true } },
                },
            },
        },
    });

    if (!session) {
        throw new BadRequestError("Session not found");
    }

    // Authorization — therapist-only
    if (session.booking.therapist.userId !== userId) {
        throw new BadRequestError("Unauthorized");
    }

    if (session.status !== SESSION_STATUS.SCHEDULED) {
        throw new BadRequestError(
            `Cannot mark session as attempted from '${session.status}' status. Session must be scheduled.`
        );
    }

    if (session.scheduledDate && new Date(session.scheduledDate) > new Date()) {
        throw new BadRequestError(
            "You can only mark an attempted visit after the scheduled date has passed."
        );
    }

    const booking = session.booking;

    const attemptedRate = booking.attemptedVisitRate != null
        ? parseFloat(booking.attemptedVisitRate)
        : null;

    if (attemptedRate == null || attemptedRate <= 0) {
        throw new BadRequestError(
            "Attempted visit rate is not configured for this booking. Use Mark Missed instead."
        );
    }

    const sessionRate = parseFloat(booking.rate);
    if (attemptedRate > sessionRate) {
        throw new BadRequestError(
            "Attempted visit rate cannot exceed the session rate. Contact support."
        );
    }

    const payment = booking.payment;
    if (!payment) {
        throw new BadRequestError("No payment record found for this booking");
    }
    if (!["escrowed", "partially_released"].includes(payment.status)) {
        throw new BadRequestError(
            `Cannot process an attempted visit — payment is in '${payment.status}' status.`
        );
    }

    const refundAmount = parseFloat((sessionRate - attemptedRate).toFixed(2));

    let updatedSession;
    try {
        const result = await prisma.session.updateMany({
            where: { id: sessionId, status: SESSION_STATUS.SCHEDULED },
            data: {
                status: SESSION_STATUS.ATTEMPTED,
                attemptedBy: USER_ROLES.THERAPIST,
                attemptedReason: reason.trim(),
                attemptedAt: new Date(),
                attemptedRateCharged: attemptedRate,
            },
        });
        if (result.count === 0) {
            throw new BadRequestError(
                "This session is no longer in 'scheduled' status. Refresh and try again."
            );
        }
        updatedSession = await prisma.session.findUnique({ where: { id: sessionId } });
    } catch (err) {
        if (err instanceof BadRequestError) throw err;
        throw new BadRequestError(`Failed to update session: ${err.message}`);
    }

    let sessionPayout;
    try {
        sessionPayout = await releasePartialSessionPayout({
            session: { id: session.id, sessionNumber: session.sessionNumber },
            payment: { ...payment },
            booking: {
                id: booking.id,
                therapist: booking.therapist,
            },
            amount: attemptedRate,
        });
    } catch (err) {
        logger.error("[Session] Attempted-visit payout failed — reverting session status", {
            sessionId,
            error: err.message,
        });
        // Best-effort revert so the therapist can retry
        await prisma.session.update({
            where: { id: sessionId },
            data: {
                status: SESSION_STATUS.SCHEDULED,
                attemptedBy: null,
                attemptedReason: null,
                attemptedAt: null,
                attemptedRateCharged: null,
            },
        }).catch((revertErr) => {
            logger.error("[Session] CRITICAL: Failed to revert session after payout failure", {
                sessionId,
                originalError: err.message,
                revertError: revertErr.message,
            });
        });
        throw new BadRequestError(`Failed to release attempted-visit payout: ${err.message}`);
    }

    let customerRefund = null;
    if (refundAmount > 0) {
        try {
            const result = await createPerSessionRefund({
                session: { id: session.id, bookingId: session.bookingId },
                payment: { id: payment.id, stripePaymentIntentId: payment.stripePaymentIntentId },
                customer: booking.customer,
                booking: {
                    id: booking.id,
                    rate: booking.rate,
                    therapist: booking.therapist,
                },
                reason: "attempted_visit_remainder",
                amount: refundAmount,
            });
            customerRefund = result.customerRefund;
        } catch (refundErr) {
            logger.error("[Session] CRITICAL: Attempted-visit remainder refund failed — payout already sent", {
                sessionId,
                bookingId: booking.id,
                attemptedRate,
                refundAmount,
                error: refundErr.message,
                sessionPayoutId: sessionPayout?.id,
            });
            // Persist for retry job — payout already released, only the customer
            // refund failed. The job will retry until resolved or permanently failed.
            await prisma.pendingRefundRetry.create({
                data: {
                    sessionId,
                    bookingId: booking.id,
                    paymentId: payment.id,
                    customerId: booking.customer.id,
                    stripePaymentIntentId: payment.stripePaymentIntentId,
                    amount: refundAmount,
                    reason: "attempted_visit_remainder",
                    errorLog: refundErr.message,
                },
            }).catch((persistErr) => {
                logger.error("[Session] CRITICAL: Failed to persist pending refund retry", {
                    sessionId,
                    error: persistErr.message,
                    originalError: refundErr.message,
                });
            });
        }
    }

    const refreshedSessions = await prisma.session.findMany({
        where: { bookingId: booking.id },
        select: { id: true, status: true },
    });
    const anyOpenSession = refreshedSessions.some((s) =>
        ![SESSION_STATUS.CONFIRMED_BY_CUSTOMER, SESSION_STATUS.CANCELLED, SESSION_STATUS.MISSED, SESSION_STATUS.ATTEMPTED].includes(s.status)
    );

    let bookingFinalized = false;
    if (!anyOpenSession && [BOOKING_STATUS.CONFIRMED, BOOKING_STATUS.IN_PROGRESS, BOOKING_STATUS.ACCEPTED].includes(booking.status)) {
        await prisma.booking.update({
            where: { id: booking.id },
            data: { status: BOOKING_STATUS.FINALIZED },
        });
        bookingFinalized = true;
        markLinkedRequestCompleted(booking.id).catch((err) =>
            logger.error("[SessionService] markLinkedRequestCompleted failed after attempted FINALIZED", { bookingId: booking.id, error: err.message })
        );
    }

    logAction({
        actorId: userId,
        action: "session.attempted_by_therapist",
        entityType: "session",
        entityId: sessionId,
        changes: {
            bookingId: booking.id,
            reason: reason.trim(),
            attemptedRate,
            refundAmount,
            sessionPayoutId: sessionPayout?.id,
            customerRefundId: customerRefund?.id,
            bookingFinalized,
        },
    });

    logger.info("[SessionService] Session marked as attempted visit", {
        sessionId,
        bookingId: booking.id,
        attemptedRate,
        refundAmount,
        bookingFinalized,
    });

    // System message — fire-and-forget
    const therapistUserId = booking.therapist.userId;
    const customerUserId = booking.customer.userId;
    findOrCreateDirectConversation(therapistUserId, customerUserId, booking.patientId || null)
        .then((conversation) =>
            createSystemMessage({
                conversationId: conversation.id,
                actorId: therapistUserId,
                recipientId: customerUserId,
                content:
                    `Attempted visit recorded for session ${session.sessionNumber ?? ""}. ` +
                    `$${attemptedRate.toFixed(2)} paid to therapist for time and travel; ` +
                    `$${refundAmount.toFixed(2)} refunded to you.`,
                systemType: "session_attempted",
                bookingId: booking.id,
            })
        )
        .catch((err) => {
            logger.error("[SessionService] System message (session_attempted) failed", { error: err.message });
        });

    // Therapist payout email — fire-and-forget
    sendAttemptedVisitTherapistPayout({
        therapist: booking.therapist,
        customer: booking.customer,
        session: updatedSession,
        booking,
        grossAmount: attemptedRate,
        refundAmount,
    }).catch((err) => {
        logger.error("[SessionService] Attempted visit therapist payout email failed", { error: err.message });
    });

    return {
        session: updatedSession,
        customerRefund,
        sessionPayout,
        bookingFinalized,
    };
};

/**
 * Get session by ID
 */
export const getSessionById = async (sessionId, userId) => {
    const bookingIds = await prisma.session.findUnique({
        where: { id: sessionId },
        select: { booking: { select: { customerId: true, therapistId: true } } },
    });

    if (!bookingIds) {
        throw new Error("Session not found");
    }

    const { customerId: customerProfileId, therapistId: therapistProfileId } = bookingIds.booking;
    const canViewContact = await hasContactAccessByProfileId(customerProfileId, therapistProfileId);

    const session = await prisma.session.findUnique({
        where: { id: sessionId },
        include: {
            booking: {
                include: {
                    customer: { select: CUSTOMER_SAFE_SELECT },
                    therapist: { select: { ...therapistSelectFor(canViewContact), user: { select: { id: true, email: true } } } },
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
                    therapist: { select: therapistSelectFor(true) },
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

    if (![SESSION_STATUS.PENDING_SCHEDULE, SESSION_STATUS.SCHEDULED].includes(session.status)) {
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
            status: SESSION_STATUS.SCHEDULED,
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

const LOCKED_VISIT_TITLE_STATUSES = [
    SESSION_STATUS.CONFIRMED_BY_CUSTOMER,
    SESSION_STATUS.MISSED,
    SESSION_STATUS.ATTEMPTED,
    SESSION_STATUS.CANCELLED,
];

export const updateSessionTitle = async (sessionId, therapistId, title) => {
    const session = await prisma.session.findUnique({
        where: { id: sessionId },
        include: { booking: { include: { therapist: true } } },
    });

    if (!session) {
        throw new Error("Session not found");
    }

    if (session.booking.therapistId !== therapistId) {
        throw new Error("Unauthorized");
    }

    if (LOCKED_VISIT_TITLE_STATUSES.includes(session.status)) {
        throw new BadRequestError("This visit's title can no longer be edited");
    }

    const trimmedTitle = title?.trim() || null;
    if (trimmedTitle && trimmedTitle.length > MAX_VISIT_TITLE_LENGTH) {
        throw new BadRequestError(`Visit title must be ${MAX_VISIT_TITLE_LENGTH} characters or fewer`);
    }

    const updatedSession = await prisma.session.update({
        where: { id: sessionId },
        data: { visitTitle: trimmedTitle },
    });

    logAction({
        actorId: session.booking.therapist.userId,
        action: "session.title_updated",
        entityType: "session",
        entityId: sessionId,
        changes: {
            bookingId: session.bookingId,
            sessionNumber: session.sessionNumber,
            visitTitle: trimmedTitle,
        },
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