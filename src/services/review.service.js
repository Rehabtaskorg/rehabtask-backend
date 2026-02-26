import { prisma } from "../config/prisma.js";
import {
    NotFoundError, BadRequestError,
    ConflictError, AuthorizationError
} from "../utils/errors.js";

export const createReview = async (customerId, data) => {
    const { bookingId, rating, comment } = data;

    const booking = await prisma.booking.findUnique({
        where: { id: bookingId },
        include: {
            customer: true,
            therapist: true,
        },
    });

    if (!booking) throw new NotFoundError("Booking not found");

    if (booking.customerId !== customerId) {
        throw new AuthorizationError("You can only review your own bookings");
    }

    if (booking.status !== "completed") {
        throw new BadRequestError(
            "Reviews can only be submitted for completed bookings"
        );
    }

    const existingReview = await prisma.review.findUnique({
        where: { bookingId },
    });

    if (existingReview) {
        throw new ConflictError("You have already reviewed this booking");
    }

    const review = await prisma.review.create({
        data: {
            bookingId,
            customerId,
            therapistId: booking.therapistId,
            rating,
            comment: comment || null,
        },
    });

    return review;
}

export const getCustomerReviews = async (customerId) => {
    const reviews = await prisma.review.findMany({
        where: { customerId },
        include: {
            therapist: {
                select: {
                    fullName: true,
                    profilePhotoUrl: true,
                    specialization: true,
                },
            },
            booking: {
                select: {
                    scheduledDate: true,
                    sessionType: true,
                },
            },
        },
        orderBy: { createdAt: "desc" }
    });

    return reviews;
}