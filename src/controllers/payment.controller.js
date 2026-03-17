import {
    createPaymentIntent, getCustomerPaymentHistory,
    getTherapistPayoutHistory, createConnectAccountLink,
    getConnectAccountStatus,
    processRefund,
    createDashboardLink,
    getPaymentMethods,
    createSetupIntent,
    removePaymentMethod,
    setDefaultPaymentMethod,
} from "../services/payment.service.js";
import { logAction } from "../services/audit.service.js";

/**
 * Create payment intent for booking
 */
const createPaymentIntentController = async (req, res, next) => {
    try {
        const { bookingId, paymentMethodId } = req.body;
        const userId = req.user.id;
        const result = await createPaymentIntent(bookingId, userId, paymentMethodId || null);

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
 * Process refund
 */
const processRefundController = async (req, res, next) => {
    try {
        const { bookingId, reason } = req.body;
        const { refund, paymentId, amount } = await processRefund(bookingId, req.user.id, reason);

        // Audit: customer-initiated refund
        logAction({
            actorId: req.user.id,
            action: "payment.refunded",
            entityType: "payment",
            entityId: paymentId,
            changes: {
                trigger: "customer_request",
                bookingId,
                amount,
                reason,
                stripeRefundId: refund?.id || null,
            },
        });

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

/**
 * List saved payment methods
 */
const getPaymentMethodsController = async (req, res, next) => {
    try {
        const methods = await getPaymentMethods(req.user.id);
        res.status(200).json({ success: true, data: methods });
    } catch (error) {
        next(error);
    }
};

/**
 * Create SetupIntent for saving a card
 */
const createSetupIntentController = async (req, res, next) => {
    try {
        const result = await createSetupIntent(req.user.id);
        res.status(200).json({ success: true, data: result });
    } catch (error) {
        next(error);
    }
};

/**
 * Remove a saved payment method
 */
const removePaymentMethodController = async (req, res, next) => {
    try {
        const result = await removePaymentMethod(req.user.id, req.params.paymentMethodId);
        res.status(200).json({ success: true, data: result });
    } catch (error) {
        next(error);
    }
};

/**
 * Set default payment method
 */
const setDefaultPaymentMethodController = async (req, res, next) => {
    try {
        const result = await setDefaultPaymentMethod(req.user.id, req.params.paymentMethodId);
        res.status(200).json({ success: true, data: result });
    } catch (error) {
        next(error);
    }
};

export {
    createPaymentIntentController,
    getPaymentHistoryController,
    getPayoutHistoryController,
    createConnectAccountController,
    getConnectAccountStatusController,
    processRefundController,
    createDashboardLinkController,
    getPaymentMethodsController,
    createSetupIntentController,
    removePaymentMethodController,
    setDefaultPaymentMethodController,
};