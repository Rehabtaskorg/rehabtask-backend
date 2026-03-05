import {
    adminListSubscriptions as adminListSubscriptionsService,
    adminGetSubscription as adminGetSubscriptionService,
    adminCancelSubscription as adminCancelSubscriptionService,
    adminGetSubscriptionStats as adminGetSubscriptionStatsService,
} from "../services/admin.subscription.service.js";

const adminListSubscriptionsController = async (req, res, next) => {
    try {
        const { status, planType, page, limit } = req.query;
        const result = await adminListSubscriptionsService({
            status,
            planType,
            page: parseInt(page) || 1,
            limit: Math.min(parseInt(limit) || 20, 100),
        });
        res.status(200).json({ success: true, data: result });
    } catch (error) {
        next(error);
    }
};

const adminGetSubscriptionController = async (req, res, next) => {
    try {
        const { subscriptionId } = req.params;
        const subscription = await adminGetSubscriptionService(subscriptionId);
        res.status(200).json({ success: true, data: subscription });
    } catch (error) {
        next(error);
    }
};

const adminCancelSubscriptionController = async (req, res, next) => {
    try {
        const adminId = req.user.id;
        const { subscriptionId } = req.params;
        const subscription = await adminCancelSubscriptionService(subscriptionId, adminId);
        res.status(200).json({ success: true, data: subscription });
    } catch (error) {
        next(error);
    }
};

const adminGetSubscriptionStatsController = async (req, res, next) => {
    try {
        const stats = await adminGetSubscriptionStatsService();
        res.status(200).json({ success: true, data: stats });
    } catch (error) {
        next(error);
    }
};

export {
    adminListSubscriptionsController,
    adminGetSubscriptionController,
    adminCancelSubscriptionController,
    adminGetSubscriptionStatsController,
};