import { prisma } from "../config/prisma.js";
import {
    sendBookingRescheduleProposed,
    sendBookingRescheduleAccepted,
    sendBookingRescheduleDeclined
} from "./email.service.js";
import { logger } from "../config/logger.js";

/**
 * Get booking by ID
 */
export const getBookingById = async (bookingId, userId) => {
    const booking = await prisma.booking.findUnique({
        where: { id: bookingId },
        include: {
            customer: { include: { user: true } },
            therapist: { include: { user: true } },
            visitTypeRef: true,
            offer: {
                include: {
                    visitTypeRef: true,
                    request: { include: { visitTypeRef: true } },
                },
            },
            payment: true,
            sessions: { orderBy: { sessionNumber: "asc" } },
            patient: {
                select: { id: true, fullName: true, email: true, phone: true }
            },
        },
    });

    if (!booking) {
        throw new Error("Booking not found");
    }

    const isCustomer = booking.customer.userId === userId;
    const isTherapist = booking.therapist.userId === userId;

    if (!isCustomer && !isTherapist) {
        throw new Error("Unauthorized");
    }

    return booking;
}

/**
 * Get customer bookings
 */
export const getCustomerBookings = async (customerId) => {
    const bookings = await prisma.booking.findMany({
        where: { customerId },
        include: {
            therapist: true,
            visitTypeRef: true,
            offer: {
                include: {
                    visitTypeRef: true,
                    request: { include: { visitTypeRef: true } },
                },
            },
            payment: true,
            patient: {
                select: { id: true, fullName: true, email: true, phone: true }
            },
            sessions: { orderBy: { sessionNumber: "asc" } },
        },
        orderBy: { scheduledDate: "desc" },
    });

    return bookings;
}

/**
 * Get therapist bookings
 */
export const getTherapistBookings = async (therapistId) => {
    const bookings = await prisma.booking.findMany({
        where: { therapistId },
        include: {
            customer: true,
            visitTypeRef: true,
            offer: {
                include: {
                    visitTypeRef: true,
                    request: { include: { visitTypeRef: true } },
                },
            },
            payment: true,
            sessions: { orderBy: { sessionNumber: "asc" } },
            patient: {
                select: { id: true, fullName: true, email: true, phone: true }
            },
        },
        orderBy: { scheduledDate: "desc" },
    });

    return bookings;
}

/**
 * Therapist proposes a new session date (reschedule)
 */
export const rescheduleBooking = async (bookingId, therapistId, newDate) => {
    const booking = await prisma.booking.findUnique({
        where: { id: bookingId },
        include: {
            customer: {
                include: { user: { select: { id: true, email: true } } }
            },
            therapist: {
                include: { user: { select: { id: true, email: true } } }
            },
            sessions: { orderBy: { sessionNumber: "asc" } },
        },
    });

    if (!booking) {
        const err = new Error("Booking not found");
        err.statusCode = 404;
        throw err;
    }

    if (booking.therapistId !== therapistId) {
        const err = new Error("Unauthorized");
        err.statusCode = 403;
        throw err;
    }

    if (!["pending", "accepted", "confirmed"].includes(booking.status)) {
        throw new Error("Cannot reschedule a booking that is not pending, accepted, or confirmed");
    }

    const proposedDate = new Date(newDate);
    if (proposedDate <= new Date()) {
        throw new Error("New date must be in the future");
    }


    const updatedBooking = await prisma.booking.update({
        where: { id: bookingId },
        data: {
            status: "reschedule_requested",
            proposedNewDate: proposedDate
        },
    });

    sendBookingRescheduleProposed({
        customer: booking.customer,
        therapist: booking.therapist,
        booking,
        newDate: proposedDate
    }).catch((err) => {
        logger.error('[BookingService] Reschedule proposed notification failed', { error: err.message });
    });

    return updatedBooking;
}

/**
 * Customer accepts or declines a reschedule proposal
 */
export const respondToReschedule = async (bookingId, customerId, accept, reason) => {
    const booking = await prisma.booking.findUnique({
        where: { id: bookingId },
        include: {
            customer: true,
            therapist: {
                include: { user: { select: { id: true, email: true } } }
            },
            sessions: { orderBy: { sessionNumber: "asc" } },
        },
    });

    if (!booking) {
        const err = new Error("Booking not found");
        err.statusCode = 404;
        throw err;
    }

    if (booking.customerId !== customerId) {
        const err = new Error("Unauthorized");
        err.statusCode = 403;
        throw err;
    }

    if (booking.status !== "reschedule_requested") {
        throw new Error("No pending reschedule request for this booking");
    }

    // Determine which status to restore based on whether payment was made
    // If session exists, payment was made → restore to "confirmed"
    // If no session, booking is pre-payment → restore to "accepted" (new flow) or "pending" (legacy)
    const restoreStatus = booking.session ? "confirmed" : "accepted";
    const newScheduledDate = booking.proposedNewDate;

    if (accept) {
        const updatedBooking = await prisma.booking.update({
            where: { id: bookingId },
            data: {
                scheduledDate: newScheduledDate,
                status: restoreStatus,
                proposedNewDate: null
            },
        });

        // Also update the first scheduled session's date if it exists
        const firstSession = booking.sessions?.find(s => s.status === "scheduled");
        if (firstSession) {
            await prisma.session.update({
                where: { id: firstSession.id },
                data: { scheduledDate: newScheduledDate },
            });
        }

        sendBookingRescheduleAccepted({
            therapist: booking.therapist,
            booking: updatedBooking,
        }).catch((err) => {
            logger.error('[BookingService] Reschedule accepted notification failed', { error: err.message });
        });

        return updatedBooking;
    } else {
        const updatedBooking = await prisma.booking.update({
            where: { id: bookingId },
            data: {
                status: restoreStatus,
                proposedNewDate: null,
            },
        });

        sendBookingRescheduleDeclined({
            therapist: booking.therapist,
            booking,
            reason
        }).catch((err) => {
            logger.error('[BookingService] Reschedule declined notification failed', { error: err.message });
        });

        return updatedBooking;
    }
}