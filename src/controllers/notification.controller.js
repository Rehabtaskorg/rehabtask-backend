import {
    getUserNotifications,
    markAsRead as markAsReadService,
    markAllAsRead as markAllAsReadService,
} from "../services/notification.service.js";

const getNotificationsController = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const page = parseInt(req.query.page) || 1;
        const limit = Math.min(parseInt(req.query.limit) || 20, 50);
        const unreadOnly = req.query.unreadOnly === "true";
        const result = await getUserNotifications(userId, { page, limit, unreadOnly });
        res.status(200).json({ success: true, data: result });
    } catch (error) {
        next(error);
    }
};

const markAsReadController = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const { notificationId } = req.params;
        await markAsReadService(notificationId, userId);
        res.status(200).json({ success: true, data: { message: "Notification marked as read" } });
    } catch (error) {
        next(error);
    }
};

const markAllAsReadController = async (req, res, next) => {
    try {
        const userId = req.user.id;
        await markAllAsReadService(userId);
        res.status(200).json({ success: true, data: { message: "All notifications marked as read" } });
    } catch (error) {
        next(error);
    }
};

export { getNotificationsController, markAsReadController, markAllAsReadController }