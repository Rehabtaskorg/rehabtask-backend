import { acceptOffer, createOffer, getTherapistOffers } from "../services/offer.service.js";

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
        const offers = getTherapistOffers(therapistId);

        res.status(200).json({ success: true, data: offers });
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

export {
    createOfferController,
    getTherapistOffersController,
    acceptOfferController
}