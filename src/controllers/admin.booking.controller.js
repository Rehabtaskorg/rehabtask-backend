import {
    adminListBookings as adminListBookingsService,
    adminGetBooking as adminGetBookingService,
    adminCancelBooking as adminCancelBookingService,
} from "../services/admin.booking.service.js";

const adminListBookingsController = async (req, res, next) => {
    try {
        const { status, page, limit } = req.query;
        const result = await adminListBookingsService({
            status,
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
        res.status(200).json({ success: true, data: booking });
    } catch (error) {
        next(error);
    }
};

export {
    adminListBookingsController,
    adminGetBookingController,
    adminCancelBookingController,
};