import {
    adminListBookings as adminListBookingsService,
    adminGetBooking as adminGetBookingService,
    adminCancelBooking as adminCancelBookingService,
    adminGetBookingStats as adminGetBookingStatsService,
    adminApproveReschedule as adminApproveRescheduleService,
    adminDenyReschedule as adminDenyRescheduleService,
} from "../services/admin.booking.service.js";
import { logAction } from "../services/audit.service.js";

const adminListBookingsController = async (req, res, next) => {
    try {
        const { status, search, sortBy, sortOrder, startDate, endDate, page, limit } = req.query;
        const result = await adminListBookingsService({
            status,
            search,
            sortBy,
            sortOrder,
            startDate,
            endDate,
            page: parseInt(page) || 1,
            limit: Math.min(parseInt(limit) || 20, 100),
        });
        res.status(200).json({ success: true, data: result });
    } catch (error) {
        next(error);
    }
};

const adminGetBookingController = async (req, res, next) => {
    try {
        const { bookingId } = req.params;
        const booking = await adminGetBookingService(bookingId);
        res.status(200).json({ success: true, data: booking });
    } catch (error) {
        next(error);
    }
};

const adminCancelBookingController = async (req, res, next) => {
    try {
        const adminId = req.user.id;
        const { bookingId } = req.params;
        const { reason } = req.body;
        const booking = await adminCancelBookingService(bookingId, adminId, reason);
        await logAction({
            actorId: adminId,
            action: "booking.cancelled",
            entityType: "booking",
            entityId: bookingId,
            changes: { status: { to: "cancelled" }, reason },
        });
        res.status(200).json({ success: true, data: booking });
    } catch (error) {
        next(error);
    }
};

const adminGetBookingStatsController = async (req, res, next) => {
    try {
        const stats = await adminGetBookingStatsService();
        res.status(200).json({ success: true, data: stats });
    } catch (error) {
        next(error);
    }
};

const adminApproveRescheduleController = async (req, res, next) => {
    try {
        const adminId = req.user.id;
        const { bookingId } = req.params;
        const booking = await adminApproveRescheduleService(bookingId, adminId);
        await logAction({
            actorId: adminId,
            action: "booking.reschedule_approved",
            entityType: "booking",
            entityId: bookingId,
            changes: { newDate: booking.scheduledDate },
        });
        res.status(200).json({ success: true, data: booking });
    } catch (error) {
        next(error);
    }
};

const adminDenyRescheduleController = async (req, res, next) => {
    try {
        const adminId = req.user.id;
        const { bookingId } = req.params;
        const { reason } = req.body;
        const booking = await adminDenyRescheduleService(bookingId, adminId, reason);
        await logAction({
            actorId: adminId,
            action: "booking.reschedule_denied",
            entityType: "booking",
            entityId: bookingId,
            changes: { reason },
        });
        res.status(200).json({ success: true, data: booking });
    } catch (error) {
        next(error);
    }
};

export {
    adminListBookingsController,
    adminGetBookingController,
    adminCancelBookingController,
    adminGetBookingStatsController,
    adminApproveRescheduleController,
    adminDenyRescheduleController,
};
