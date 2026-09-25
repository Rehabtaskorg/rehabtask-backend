import { prisma } from "../config/prisma.js";
import { USER_ROLES, BOOKING_STATUS } from "../utils/constants.js";
import {
    getTherapistProfile as getTherapistProfileService,
    updateTherapistProfile as updateTherapistProfileService,
    updateWorkAreas as updateWorkAreasService,
    updateAvailability as updateAvailabilityService,
    searchTherapists as searchTherapistsService,
    getTherapistPublicProfile as getTherapistPublicProfileService,
    getTherapistReviews as getTherapistReviewsService,
} from "../services/therapist.service.js";

// Private controllers

const getTherapistProfileController = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const profile = await getTherapistProfileService(userId);
        res.status(200).json({ success: true, data: profile });
    } catch (error) {
        next(error);
    }
};

const updateTherapistProfileController = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const profile = await updateTherapistProfileService(userId, req.body);
        res.status(200).json({ success: true, data: profile });
    } catch (error) {
        next(error);
    }
};

const updateWorkAreasController = async (req, res, next) => {
    try {
        const therapistId = req.user.therapistProfile.id;
        const workAreas = await updateWorkAreasService(
            therapistId,
            req.body.workAreas
        );
        res.status(200).json({ success: true, data: workAreas });
    } catch (error) {
        next(error);
    }
}

const updateAvailabilityController = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const availability = await updateAvailabilityService(
            userId,
            req.body.schedule
        );
        res.status(200).json({ success: true, data: availability });
    } catch (error) {
        next(error);
    }
}

// Public controllers
const searchTherapistsController = async (req, res, next) => {
    try {
        const result = await searchTherapistsService(req.query);
        res.status(200).json({ success: true, data: result });
    } catch (error) {
        next(error);
    }
};

const getTherapistPublicProfileController = async (req, res, next) => {
    try {
        const { therapistId } = req.params;
        const viewerUserId = req.user?.id ?? null;
        const viewerRole = req.user?.role ?? null;
        const profile = await getTherapistPublicProfileService(therapistId, viewerUserId, viewerRole);

        if (req.user && req.user.role === USER_ROLES.CUSTOMER) {
            const customerProfile = await prisma.customerProfile.findUnique({
                where: { userId: req.user.id },
                select: { id: true },
            });

            if (customerProfile) {
                const reviewableBookings = await prisma.booking.findMany({
                    where: {
                        customerId: customerProfile.id,
                        therapistId: therapistId,
                        status: BOOKING_STATUS.COMPLETED,
                        review: null,
                    },
                    select: { id: true, scheduledDate: true },
                    orderBy: { scheduledDate: "desc" },
                });
                profile.reviewableBookings = reviewableBookings;
            }
        }

        res.status(200).json({ success: true, data: profile });
    } catch (error) {
        next(error);
    }
};

const getTherapistReviewsController = async (req, res, next) => {
    try {
        const { therapistId } = req.params;
        const { page, limit } = req.query;
        const result = await getTherapistReviewsService(
            therapistId,
            page ? parseInt(page, 10) : 1,
            limit ? parseInt(limit, 10) : 10
        );
        res.status(200).json({ success: true, data: result });
    } catch (error) {
        next(error);
    }
}

const getPlatformStatsController = async (req, res, next) => {
    try {
        const { getPlatformStats } = await import("../services/therapist.service.js");
        const stats = await getPlatformStats();
        res.status(200).json({ success: true, data: stats });
    } catch (error) {
        next(error);
    }
};

export {
    getTherapistProfileController,
    updateTherapistProfileController,
    updateWorkAreasController,
    updateAvailabilityController,
    searchTherapistsController,
    getTherapistPublicProfileController,
    getTherapistReviewsController,
    getPlatformStatsController,
}