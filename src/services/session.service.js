import { prisma } from "../config/prisma.js";

/**
 * Mark session as completed by therapist
 */
export const completeSessionByTherapist = async (sessionId, therapistId) => {
    const session = await prisma.session.findUnique({
        where: { id: sessionId },
        include: {
            booking: true,
        },
    });

    if (!session) {
        throw new Error("Session not found");
    }

    if (session.booking.therapistId !== therapistId) {
        throw new Error("Unauthorized");
    }

    if (session.status !== "scheduled") {
        throw new Error("Session must be in scheduled status");
    }

    const updatedSession = await prisma.session.update({
        where: { id: sessionId },
        data: {
            status: "completed_by_therapist",
            completedAt: new Date(),
        },
    });

    // Update booking status
    await prisma.booking.update({
        where: { id: session.bookingId },
        data: { status: "in_progress" },
    });

    return updatedSession;
}

/**
 * Confirm session completion by customer
 */
export const confirmSessionByCustomer = async (sessionId, customerId) => {
    const session = await prisma.session.findUnique({
        where: { id: sessionId },
        include: {
            booking: true,
        },
    });

    if (!session) {
        throw new Error("Session not found");
    }

    if (session.booking.customerId !== customerId) {
        throw new Error("Unauthorized");
    }

    if (session.status !== "completed_by_therapist") {
        throw new Error("Therapist must complete session first");
    }

    const updatedSession = await prisma.session.update({
        where: { id: sessionId },
        data: {
            status: "confirmed_by_customer",
            confirmedByCustomerAt: new Date(),
        },
    });

    // Update booking to completed
    await prisma.booking.update({
        where: { id: session.bookingId },
        data: { status: "completed" },
    });

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

    const updatedSession = await prisma.session.update({
        where: { id: sessionId },
        data: {
            status: "cancelled",
            cancellationReason: reason
        },
    });

    await prisma.booking.update({
        where: { id: session.bookingId },
        data: { status: "cancelled" },
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