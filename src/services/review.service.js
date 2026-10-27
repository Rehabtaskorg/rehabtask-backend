import { prisma } from "../config/prisma.js";
import { BOOKING_STATUS } from "../utils/constants.js";
import {
    NotFoundError, BadRequestError,
    ConflictError, AuthorizationError
} from "../utils/errors.js";

const averageRating = (...ratings) =>
    Math.round(ratings.reduce((sum, value) => sum + value, 0) / ratings.length);

export const createReview = async (customerId, data) => {
    const { bookingId, communicationRating, documentationRating, professionalismRating, comment } = data;

    const booking = await prisma.booking.findUnique({
        where: { id: bookingId },
        select: { customerId: true, therapistId: true, status: true },
    });

    if (!booking) throw new NotFoundError("Booking not found");

    if (booking.customerId !== customerId) {
        throw new AuthorizationError("You can only review your own bookings");
    }

    if (booking.status !== BOOKING_STATUS.COMPLETED) {
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
            rating: averageRating(communicationRating, documentationRating, professionalismRating),
            communicationRating,
            documentationRating,
            professionalismRating,
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