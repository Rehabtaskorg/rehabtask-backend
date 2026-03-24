import { prisma } from "../config/prisma.js";
import { BadRequestError } from "../utils/errors.js";
import { logger } from "../config/logger.js";
import { sendSessionCompletionRequest, sendSessionConfirmed } from "./email.service.js";
import { logAction } from "./audit.service.js";
import { releasePayment } from "./payment.service.js";

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

        // Only transition booking to in_progress if it's currently confirmed
        // (avoid overwriting in_progress for multi-session bookings)
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
    // This allows safe retries when releasePayment fails after confirm.
    if (session.status === "confirmed_by_customer") {
        return session;
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

        // Check if ALL sessions for this booking are now confirmed
        const allSessions = await tx.session.findMany({
            where: { bookingId: session.bookingId },
        });
        const totalSessions = allSessions.length;
        const confirmedCount = allSessions.filter(s =>
            s.id === sessionId || s.status === "confirmed_by_customer"
        ).length;

        if (confirmedCount === totalSessions) {
            // ALL sessions confirmed — mark booking completed
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

    if (session.status !== "pending_schedule") {
        throw new BadRequestError("Only pending sessions can be scheduled");
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