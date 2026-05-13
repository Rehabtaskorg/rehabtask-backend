import { BOOKING_STATUS } from "../utils/constants.js";
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
    sessions: { select: { id: true, status: true, sessionNumber: true, scheduledDate: true, completedAt: true }, orderBy: { sessionNumber: "asc" } },
    patient: {
        select: { id: true, fullName: true, email: true, phone: true },
    },
};

// Valid sortBy fields mapped to their Prisma field names
const VALID_SORT_FIELDS = ["scheduledDate", "createdAt", "rate", "status"];

export const adminListBookings = async ({
    status,
    search,
    sortBy = "createdAt",
    sortOrder = "desc",
    startDate,
    endDate,
    page = 1,
    limit = 20,
} = {}) => {
    const where = {};

    if (status) where.status = status;

    // Date range filter on scheduledDate
    if (startDate || endDate) {
        where.scheduledDate = {};
        if (startDate) {
            where.scheduledDate.gte = new Date(startDate);
        }
        if (endDate) {
            const end = new Date(endDate);
            end.setUTCHours(23, 59, 59, 999);
            where.scheduledDate.lte = end;
        }
    }

    // Full-text search across customer name, therapist name, and emails
    if (search && search.trim()) {
        const term = search.trim();
        where.OR = [
            { customer: { fullName: { contains: term, mode: "insensitive" } } },
            { customer: { user: { email: { contains: term, mode: "insensitive" } } } },
            { therapist: { fullName: { contains: term, mode: "insensitive" } } },
            { therapist: { user: { email: { contains: term, mode: "insensitive" } } } },
        ];
    }

    // Guard against invalid sort field (validator should catch this, but be defensive)
    const resolvedSortBy = VALID_SORT_FIELDS.includes(sortBy) ? sortBy : "createdAt";
    const orderBy = { [resolvedSortBy]: sortOrder === "asc" ? "asc" : "desc" };

    const [bookings, total] = await Promise.all([
        prisma.booking.findMany({
            where,
            include: BOOKING_INCLUDE,
            orderBy,
            skip: (page - 1) * limit,
            take: limit,
        }),
        prisma.booking.count({ where }),
    ]);

    return {
        bookings,
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
};

export const adminGetBookingStats = async () => {
    const [total, pending, accepted, confirmed, inProgress, completed, cancelled, rescheduleRequested] =
        await Promise.all([
            prisma.booking.count(),
            prisma.booking.count({ where: { status: BOOKING_STATUS.PENDING } }),
            prisma.booking.count({ where: { status: BOOKING_STATUS.ACCEPTED } }),
            prisma.booking.count({ where: { status: BOOKING_STATUS.CONFIRMED } }),
            prisma.booking.count({ where: { status: BOOKING_STATUS.IN_PROGRESS } }),
            prisma.booking.count({ where: { status: BOOKING_STATUS.COMPLETED } }),
            prisma.booking.count({ where: { status: BOOKING_STATUS.CANCELLED } }),
            prisma.booking.count({ where: { status: BOOKING_STATUS.RESCHEDULE_REQUESTED } }),
        ]);

    return {
        total,
        pending,
        accepted,
        confirmed,
        inProgress,
        completed,
        cancelled,
        rescheduleRequested,
    };
};

export const adminGetBooking = async (bookingId) => {
    const booking = await prisma.booking.findUnique({
        where: { id: bookingId },
        include: BOOKING_INCLUDE,
    });
    if (!booking) throw new NotFoundError("Booking not found");
    return booking;
};

export const adminCancelBooking = async (bookingId, adminId, reason) => {
    const booking = await prisma.booking.findUnique({
        where: { id: bookingId },
        include: BOOKING_INCLUDE,
    });
    if (!booking) throw new NotFoundError("Booking not found");

    const cancellable = [BOOKING_STATUS.PENDING, BOOKING_STATUS.ACCEPTED, BOOKING_STATUS.CONFIRMED, BOOKING_STATUS.RESCHEDULE_REQUESTED];
    if (!cancellable.includes(booking.status)) {
        throw new ConflictError(
            `Booking cannot be cancelled in status '${booking.status}'`
        );
    }

    const updated = await prisma.booking.update({
        where: { id: bookingId },
        data: { status: BOOKING_STATUS.CANCELLED },
        include: BOOKING_INCLUDE,
    });

    sendBookingCancelledByAdmin({
        recipientEmail: booking.customer.user.email,
        recipientName: booking.customer.fullName,
        booking,
        reason,
        role: USER_ROLES.CUSTOMER,
    }).catch(() => {});

    sendBookingCancelledByAdmin({
        recipientEmail: booking.therapist.user.email,
        recipientName: booking.therapist.fullName,
        booking,
        reason,
        role: USER_ROLES.THERAPIST,
    }).catch(() => {});

    logger.info("[AdminBookingService] Booking cancelled", {
        bookingId,
        byAdmin: adminId,
        reason,
    });
    return updated;
};

export const adminApproveReschedule = async (bookingId, adminId) => {
    const booking = await prisma.booking.findUnique({
        where: { id: bookingId },
    });
    if (!booking) throw new NotFoundError("Booking not found");
    if (booking.status !== BOOKING_STATUS.RESCHEDULE_REQUESTED) {
        throw new ConflictError("Booking is not awaiting a reschedule decision");
    }
    if (!booking.proposedNewDate) {
        throw new ConflictError("No proposed new date found on this booking");
    }

    const updated = await prisma.booking.update({
        where: { id: bookingId },
        data: {
            scheduledDate: booking.proposedNewDate,
            proposedNewDate: null,
            status: BOOKING_STATUS.CONFIRMED,
        },
        include: BOOKING_INCLUDE,
    });

    logger.info("[AdminBookingService] Reschedule approved", {
        bookingId,
        newDate: booking.proposedNewDate,
        byAdmin: adminId,
    });
    return updated;
};

export const adminDenyReschedule = async (bookingId, adminId, reason) => {
    const booking = await prisma.booking.findUnique({
        where: { id: bookingId },
    });
    if (!booking) throw new NotFoundError("Booking not found");
    if (booking.status !== BOOKING_STATUS.RESCHEDULE_REQUESTED) {
        throw new ConflictError("Booking is not awaiting a reschedule decision");
    }

    const updated = await prisma.booking.update({
        where: { id: bookingId },
        data: {
            proposedNewDate: null,
            status: BOOKING_STATUS.CONFIRMED,
        },
        include: BOOKING_INCLUDE,
    });

    logger.info("[AdminBookingService] Reschedule denied", {
        bookingId,
        byAdmin: adminId,
        reason,
    });
    return updated;
};
