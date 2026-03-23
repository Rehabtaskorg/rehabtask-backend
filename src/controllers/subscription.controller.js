import {
    getSubscriptionWithUsage,
    createCheckoutSession,
    createBillingPortalSession,
    cancelSubscription,
    upgradeSubscription,
    downgradeSubscription,
    previewUpgrade,
} from "../services/subscription.service.js";

export const getSubscriptionController = async (req, res, next) => {
    try {
        const result = await getSubscriptionWithUsage(req.user.customerProfile.id);
        res.json({ success: true, data: result });
    } catch (error) {
        next(error);
    }
};

export const createCheckoutController = async (req, res, next) => {
    try {
        const { planType, billingInterval } = req.body;
        const result = await createCheckoutSession(
            req.user.customerProfile.id,
            req.user.id,
            planType,
            billingInterval
        );
        res.json({ success: true, data: result });
    } catch (error) {
        next(error);
    }
};

export const createBillingPortalController = async (req, res, next) => {
    try {
        const result = await createBillingPortalSession(req.user.id);
        res.json({ success: true, data: result });
    } catch (error) {
        next(error);
    }
};

export const cancelSubscriptionController = async (req, res, next) => {
    try {
        const result = await cancelSubscription(req.user.customerProfile.id);
        res.json({ success: true, data: result });
    } catch (error) {
        next(error);
    }
};

export const previewUpgradeController = async (req, res, next) => {
    try {
        const { planType, billingInterval } = req.body;
        const result = await previewUpgrade(req.user.customerProfile.id, planType, billingInterval);
        res.json({ success: true, data: result });
    } catch (error) {
        next(error);
    }
};

export const upgradeSubscriptionController = async (req, res, next) => {
    try {
        const { planType, billingInterval } = req.body;
        const result = await upgradeSubscription(req.user.customerProfile.id, planType, billingInterval);
        res.json({ success: true, data: result });
    } catch (error) {
        // Return 402 for payment failures instead of 500
        if (error.statusCode === 402 || error.code === "PAYMENT_FAILED") {
            return res.status(402).json({
                success: false,
                code: "PAYMENT_FAILED",
                message: error.message,
            });
        }
        next(error);
    }
};

export const downgradeSubscriptionController = async (req, res, next) => {
    try {
        const { planType, billingInterval } = req.body;
        const result = await downgradeSubscription(req.user.customerProfile.id, planType, billingInterval);
        res.json({ success: true, data: result });
    } catch (error) {
        next(error);
    }
};