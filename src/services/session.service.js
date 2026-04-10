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
import { releasePayment } from "./payment.service.js";
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
                    ? `Session confirmed (${updatedSession._confirmedCount}/${updatedSession._totalSessions}). All sessions complete — payment released.`
                    : `Session confirmed (${updatedSession._confirmedCount}/${updatedSession._totalSessions}).`,
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

    // Release payment only when ALL sessions are confirmed
    if (updatedSession._allConfirmed) {
        try {
            await releasePayment(sessionId);
            logger.info("[Session] All sessions confirmed — payment released", {
                bookingId: session.bookingId,
                totalSessions: updatedSession._totalSessions,
            });
        } catch (err) {
            logger.error("[Session] Payment release failed after all sessions confirmed", {
                bookingId: session.bookingId,
                error: err.message,
            });
        }
    } else {
        logger.info("[Session] Session confirmed, waiting for remaining", {
            bookingId: session.bookingId,
            confirmed: updatedSession._confirmedCount,
            total: updatedSession._totalSessions,
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
 * Therapist responds to a revision request and re-submits the session.
 *
 * Critical: completedAt is reset to NOW so the existing autoConfirm cron
 * starts a fresh 72h window for the customer to review the revised work.
 * Without this reset the original completedAt is now stale and the cron
 * would auto-confirm immediately on its next tick.
 *
 * revisionDueBy is a soft commitment date — stored and shown in the UI but
 * NOT enforced by any cron. It's communication, not enforcement.
 */
export const submitSessionRevision = async (sessionId, therapistId, { dueBy }) => {
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
            "Only sessions awaiting revision can be resubmitted.",
            "INVALID_SESSION_STATUS"
        );
    }

    const now = new Date();

    const updatedSession = await prisma.session.update({
        where: { id: sessionId },
        data: {
            status: "completed_by_therapist",
            // Reset completedAt so the customer gets a fresh 72h auto-confirm window
            completedAt: now,
            revisionDueBy: dueByDate,
            revisionLastSubmittedAt: now,
        },
    });

    logAction({
        actorId: session.booking.therapist.user.id,
        action: "session.revision_submitted",
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
                content: `Therapist resubmitted the session. Please review and confirm.`,
                systemType: "session_revision_submitted",
                bookingId: session.bookingId,
            })
        )
        .catch((err) => {
            logger.error("[SessionService] System message (session_revision_submitted) failed", { error: err.message });
        });

    // Notify customer
    sendSessionRevisionSubmitted({
        customer: session.booking.customer,
        therapist: session.booking.therapist,
        session: updatedSession,
        booking: session.booking,
    }).catch((err) => {
        logger.error("[SessionService] Revision submitted email failed", { error: err.message });
    });

    return updatedSession;
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