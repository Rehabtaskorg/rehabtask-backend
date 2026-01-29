import { prisma } from "../config/prisma.js";

/**
 * Get booking by ID
 */
export const getBookingById = async (bookingId, userId) => {
    const booking = await prisma.booking.findUnique({
        where: { id: bookingId },
        include: {
            customer: { include: { user: true } },
            therapist: { include: { user: true } },
            offer: {
                include: {
                    request: true
                },
            },
            payment: true,
            session: true
        }
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
            offer: {
                include: {
                    request: true,
                },
            },
            payment: true,
            session: true,
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
            offer: {
                include: {
                    request: true
                },
            },
            payment: true,
            session: true,
        },
        orderBy: { scheduledDate: "desc" },
    });

    return bookings;
}