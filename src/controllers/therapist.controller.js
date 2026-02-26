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
        const profile = await getTherapistPublicProfileService(therapistId);
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

export {
    getTherapistProfileController,
    updateTherapistProfileController,
    updateWorkAreasController,
    updateAvailabilityController,
    searchTherapistsController,
    getTherapistPublicProfileController,
    getTherapistReviewsController,
}