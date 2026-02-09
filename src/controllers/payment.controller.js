import {
    createPaymentIntent, getCustomerPaymentHistory,
    getTherapistPayoutHistory, createConnectAccountLink,
    getConnectAccountStatus, releasePayment,
    processRefund,
    createDashboardLink
} from "../services/payment.service.js";

/**
 * Create payment intent for booking
 */
const createPaymentIntentController = async (req, res, next) => {
    try {
        const { bookingId } = req.body;
        const userId = req.user.id;
        const result = await createPaymentIntent(bookingId, userId);

        res.status(200).json({ success: true, data: result });
    } catch (error) {
        next(error);
    }
}

/**
 * Get customer payment history
 */
const getPaymentHistoryController = async (req, res, next) => {
    try {
        const customerId = req.user.customerProfile.id;
        const payments = await getCustomerPaymentHistory(customerId);

        res.status(200).json({ success: true, data: payments });
    } catch (error) {
        next(error);
    }
}

/**
 * Get therapist payout history
 */
const getPayoutHistoryController = async (req, res, next) => {
    try {
        if (!req.user.therapistProfile) {
            return res.status(403).json({
                success: false,
                message: "Only therapists can access payout history"
            });
        }

        const therapistId = req.user.therapistProfile.id;
        const result = await getTherapistPayoutHistory(therapistId);
        res.status(200).json({ success: true, data: result });
    } catch (error) {
        next(error);
    }
}

/**
 * Create Stripe Connect account link
 */
const createConnectAccountController = async (req, res, next) => {
    try {
        const therapistId = req.user.therapistProfile.id;
        const userId = req.user.id;
        const result = await createConnectAccountLink(therapistId, userId);

        res.status(200).json({ success: true, data: result });
    } catch (error) {
        next(error);
    }
}

/**
 * Get Stripe Connect account status
 */
const getConnectAccountStatusController = async (req, res, next) => {
    try {
        const therapistId = req.user.therapistProfile.id;
        const status = await getConnectAccountStatus(therapistId);

        res.status(200).json({ success: true, data: status });
    } catch (error) {
        next(error);
    }
}

/**
 * Release payment after session confirmation
 */
const releasePaymentController = async (req, res, next) => {
    try {
        const { sessionId } = req.body;
        const payment = await releasePayment(sessionId);

        res.status(200).json({ success: true, data: payment });
    } catch (error) {
        next(error);
    }
}

/**
 * Process refund
 */
const processRefundController = async (req, res, next) => {
    try {
        const { bookingId, reason } = req.body;
        const refund = await processRefund(bookingId, reason);

        res.status(200).json({ success: true, data: refund });
    } catch (error) {
        next(error);
    }
}

/**
 * Create Stripe Dashboard login link
 */
const createDashboardLinkController = async (req, res, next) => {
    try {
        const therapistId = req.user.therapistProfile.id;
        const userId = req.user.id;
        const result = await createDashboardLink(therapistId, userId);

        res.status(200).json({ success: true, data: result });
    } catch (error) {
        next(error);
    }
}

export {
    createPaymentIntentController,
    getPaymentHistoryController,
    getPayoutHistoryController,
    createConnectAccountController,
    getConnectAccountStatusController,
    releasePaymentController,
    processRefundController,
    createDashboardLinkController
};