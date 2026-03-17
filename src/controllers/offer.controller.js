import {
    acceptOffer,
    createOffer,
    getOfferById,
    getTherapistOffers,
    declineOffer,
    requestOfferChange,
    withdrawOffer,
    reviseOffer
} from "../services/offer.service.js";

/**
 * Create a new offer
 */
const createOfferController = async (req, res, next) => {
    try {
        const therapistId = req.user.therapistProfile.id;
        const offer = await createOffer(therapistId, req.body);
        res.status(201).json({ success: true, data: offer });
    } catch (error) {
        next(error);
    }
}

/**
 * Get all offers of a therapist
 */
const getTherapistOffersController = async (req, res, next) => {
    try {
        const therapistId = req.user.therapistProfile.id;
        const offers = await getTherapistOffers(therapistId);
        res.status(200).json({ success: true, data: offers });
    } catch (error) {
        next(error);
    }
}

/**
 * Get a single offer by ID (therapist read-only, for messages offer widget)
 */
const getOfferByIdController = async (req, res, next) => {
    try {
        const { offerId } = req.params;
        const userId = req.user.id;
        const offer = await getOfferById(offerId, userId);
        res.status(200).json({ success: true, data: { offer } });
    } catch (error) {
        next(error);
    }
}

/**
 * Customer accepts an offer
 */
const acceptOfferController = async (req, res, next) => {
    try {
        const { offerId } = req.params;
        const customerId = req.user.customerProfile.id;
        const result = await acceptOffer(offerId, customerId);

        res.status(200).json({ success: true, data: result });
    } catch (error) {
        next(error);
    }
}

/**
 * Revise an existing offer (after customer requested changes)
 */
export const reviseOfferController = async (req, res, next) => {
    try {
        const therapistId = req.user.therapistProfile.id;
        const { offerId } = req.params;
        const offer = await reviseOffer(therapistId, offerId, req.body);
        res.status(200).json({ success: true, data: offer })
    } catch (error) {
        next(error);
    }
}

const declineOfferController = async (req, res, next) => {
    try {
        const { offerId } = req.params;
        const customerId = req.user.customerProfile.id;
        const result = await declineOffer(offerId, customerId);
        res.status(200).json({ success: true, data: result });
    } catch (error) {
        next(error);
    }
};

const requestOfferChangeController = async (req, res, next) => {
    try {
        const { offerId } = req.params;
        const customerId = req.user.customerProfile.id;
        const { note } = req.body;
        const result = await requestOfferChange(offerId, customerId, note);
        res.status(200).json({ success: true, data: result });
    } catch (error) {
        next(error);
    }
}

const withdrawOfferController = async (req, res, next) => {
    try {
        const { offerId } = req.params;
        const therapistId = req.user.therapistProfile.id;
        const result = await withdrawOffer(offerId, therapistId);
        res.status(200).json({ success: true, data: result });
    } catch (error) {
        next(error);
    }
}

export {
    createOfferController,
    getTherapistOffersController,
    getOfferByIdController,
    acceptOfferController,
    declineOfferController,
    requestOfferChangeController,
    withdrawOfferController
}