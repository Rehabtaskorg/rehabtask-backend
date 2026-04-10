import {
    getBookingById,
    getCustomerBookings,
    getTherapistBookings,
    rescheduleBooking,
    respondToReschedule
} from "../services/booking.service.js";
import { finalizeBooking } from "../services/payment.service.js";

/**
 * Get a booking by ID
 */
const getBookingByIdController = async (req, res, next) => {
    try {
        const { bookingId } = req.params;
        const userId = req.user.id;
        const booking = await getBookingById(bookingId, userId);

        res.status(200).json({ success: true, data: booking });
    } catch (error) {
        next(error);
    }
}

/**
 * Get all bookings of a customer
 */
const getCustomerBookingsController = async (req, res, next) => {
    try {
        const customerId = req.user.customerProfile.id;
        const bookings = await getCustomerBookings(customerId);
        res.status(200).json({ success: true, data: bookings || [] });
    } catch (error) {
        next(error);
    }
}

/**
 * Get all bookings for a therapist
 */
const getTherapistBookingsController = async (req, res, next) => {
    try {
        const therapistId = req.user.therapistProfile.id;
        const bookings = await getTherapistBookings(therapistId);
        res.status(200).json({ success: true, data: bookings });
    } catch (error) {
        next(error)
    }
}

const rescheduleBookingController = async (req, res, next) => {
    try {
        const { bookingId } = req.params;
        const therapistId = req.user.therapistProfile.id;
        const { newDate } = req.body;
        const result = await rescheduleBooking(bookingId, therapistId, newDate);
        res.status(200).json({ success: true, data: result });
    } catch (error) {
        next(error);
    }
}

const respondToRescheduleController = async (req, res, next) => {
    try {
        const { bookingId } = req.params;
        const customerId = req.user.customerProfile.id;
        const { accept, reason } = req.body;
        const result = await respondToReschedule(bookingId, customerId, accept, reason);
        res.status(200).json({ success: true, data: result });
    } catch (error) {
        next(error);
    }
}

const finalizeBookingController = async (req, res, next) => {
    try {
        const { bookingId } = req.params;
        const therapistId = req.user.therapistProfile.id;
        const result = await finalizeBooking(bookingId, therapistId);
        res.status(200).json({ success: true, data: result });
    } catch (error) {
        next(error);
    }
};

export {
    getBookingByIdController,
    getCustomerBookingsController,
    getTherapistBookingsController,
    rescheduleBookingController,
    respondToRescheduleController,
    finalizeBookingController,
};