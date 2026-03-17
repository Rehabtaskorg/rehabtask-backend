import {
    getAllNotifications as getAllNotificationsService,
    broadcastNotification as broadcastNotificationService,
} from "../services/notification.service.js";

const adminGetAllNotificationsController = async (req, res, next) => {
    try {
        const { userId, type, failed, page, limit } = req.query;
        const result = await getAllNotificationsService({
            userId,
            type,
            failed: failed !== undefined ? failed === "true" : undefined,
            page: parseInt(page) || 1,
            limit: Math.min(parseInt(limit) || 20, 100),
        });
        res.status(200).json({ success: true, data: result });
    } catch (error) {
        next(error);
    }
};

const adminBroadcastNotificationController = async (req, res, next) => {
    try {
        const { role, type, title, message, metadata } = req.body;
        const result = await broadcastNotificationService({ role, type, title, message, metadata });
        res.status(200).json({ success: true, data: result });
    } catch (error) {
        next(error);
    }
};

export { adminGetAllNotificationsController, adminBroadcastNotificationController };