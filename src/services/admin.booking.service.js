import { prisma } from "../config/prisma.js";
import { NotFoundError, ConflictError } from "../utils/errors.js";
import { logger } from "../config/logger.js";
import { sendBookingCancelledByAdmin } from "./email.service.js";

const BOOKING_INCLUDE = {
    customer: {
        select: {
            id: true,
            userId: true,
            fullName: true,
            customerType: true,
            agencyName: true,
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
    payment: {
        select: {
            id: true,
            status: true,
            amount: true,
            platformFee: true,
            therapistPayout: true,
        },
    },
    session: { select: { id: true, status: true, completedAt: true } },
    patient: {
        select: { id: true, fullName: true, email: true, phone: true },
    },
};

export const adminListBookings = async ({ status, page = 1, limit = 20 } = {}) => {
    const where = {};
    if (status) where.status = status;

    const [bookings, total] = await Promise.all([
        prisma.booking.findMany({
            where,
            include: BOOKING_INCLUDE,
            orderBy: { createdAt: "desc" },
            skip: (page - 1) * limit,
            take: limit,
        }),
        prisma.booking.count({ where }),
    ]);

    return {
        bookings,
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
}

export const adminGetBooking = async (bookingId) => {
    const booking = await prisma.booking.findUnique({
        where: { id: bookingId },
        include: BOOKING_INCLUDE,
    });
    if (!booking) throw new NotFoundError("Booking not found");
    return booking;
}

export const adminCancelBooking = async (bookingId, adminId, reason) => {
    const booking = await prisma.booking.findUnique({
        where: { id: bookingId },
        include: BOOKING_INCLUDE,
    });
    if (!booking) throw new NotFoundError("Booking not found");

    const cancellable = ["pending", "confirmed", "reschedule_requested"];
    if (!cancellable.includes(booking.status)) {
        throw new ConflictError(
            `Booking cannot be cancelled in status '${booking.status}'`
        );
    }

    const updated = await prisma.booking.update({
        where: { id: bookingId },
        data: { status: "cancelled" },
        include: BOOKING_INCLUDE
    });

    sendBookingCancelledByAdmin({
        recipientEmail: booking.customer.user.email,
        recipientName: booking.customer.fullName,
        booking,
        reason,
        role: 'customer',
    }).catch(() => { });

    sendBookingCancelledByAdmin({
        recipientEmail: booking.therapist.user.email,
        recipientName: booking.therapist.fullName,
        booking,
        reason,
        role: 'therapist',
    }).catch(() => { });

    logger.info("[AdminBookingService] Booking cancelled", {
        bookingId,
        byAdmin: adminId,
        reason,
    });
    return updated;
}