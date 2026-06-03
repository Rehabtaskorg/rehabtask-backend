import {
    requestCancellation,
    approveCancellation,
    rejectCancellation,
    adminOverrideCancellation,
} from "../services/booking.cancellation.service.js";

/**
 * POST /bookings/:id/cancellation/request
 * Customer requests cancellation of a booking.
 */
export const requestCancellationController = async (req, res, next) => {
    try {
        const result = await requestCancellation(req.params.bookingId, req.user.id, req.body.reason);
        res.status(200).json({ success: true, data: result });
    } catch (err) {
        next(err);
    }
};

/**
 * POST /bookings/:id/cancellation/approve
 * Therapist approves a pending cancellation request.
 */
export const approveCancellationController = async (req, res, next) => {
    try {
        const result = await approveCancellation(req.params.bookingId, req.user.id);
        res.status(200).json({ success: true, data: result });
    } catch (err) {
        next(err);
    }
};

/**
 * POST /bookings/:id/cancellation/reject
 * Therapist rejects a pending cancellation request.
 */
export const rejectCancellationController = async (req, res, next) => {
    try {
        const result = await rejectCancellation(req.params.bookingId, req.user.id, req.body.reason);
        res.status(200).json({ success: true, data: result });
    } catch (err) {
        next(err);
    }
};

/**
 * POST /admin/bookings/:id/cancellation/approve
 * POST /admin/bookings/:id/cancellation/reject
 * Admin override — bypasses the 24h window and therapist-actor check.
 */
export const adminOverrideCancellationController = async (req, res, next) => {
    try {
        const action = req.path.endsWith("/approve") ? "approve" : "reject";
        const result = await adminOverrideCancellation(req.params.bookingId, action, req.user.id, req.body.reason);
        res.status(200).json({ success: true, data: result });
    } catch (err) {
        next(err);
    }
};
