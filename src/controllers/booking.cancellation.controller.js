import {
    requestCancellation,
    approveCancellation,
    rejectCancellation,
} from "../services/booking.cancellation.service.js";
import { adminOverrideCancellation } from "../services/booking.adminCancellation.service.js";

/**
 * POST /bookings/:id/cancellation/request
 * Either the customer or therapist requests cancellation of a booking.
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
 * The other party (customer or therapist) approves a pending cancellation request.
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
 * The other party (customer or therapist) rejects a pending cancellation request.
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
 * POST /admin/bookings/:bookingId/cancellation/approve
 * Admin override — approve without 24h restriction.
 */
export const adminApproveCancellationController = async (req, res, next) => {
    try {
        const result = await adminOverrideCancellation(req.params.bookingId, "approve", req.user.id);
        res.status(200).json({ success: true, data: result });
    } catch (err) {
        next(err);
    }
};

/**
 * POST /admin/bookings/:bookingId/cancellation/reject
 * Admin override — reject without 24h restriction.
 */
export const adminRejectCancellationController = async (req, res, next) => {
    try {
        const result = await adminOverrideCancellation(req.params.bookingId, "reject", req.user.id, req.body.reason);
        res.status(200).json({ success: true, data: result });
    } catch (err) {
        next(err);
    }
};
