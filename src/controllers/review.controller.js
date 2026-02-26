import {
    createReview as createReviewService,
    getCustomerReviews as getCustomerReviewsService
} from "../services/review.service.js";

const createReviewController = async (req, res, next) => {
    try {
        const customerId = req.user.customerProfile.id;
        const review = await createReviewService(customerId, req.body);
        res.status(201).json({ success: true, data: review });
    } catch (error) {
        next(error);
    }
}

const getCustomerReviewsController = async (req, res, next) => {
    try {
        const customerId = req.user.customerProfile.id;
        const reviews = await getCustomerReviewsService(customerId);
        res.status(200).json({ success: true, data: reviews });
    } catch (error) {
        next(error);
    }
}

export { createReviewController, getCustomerReviewsController };