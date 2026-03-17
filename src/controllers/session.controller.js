import {
    completeSessionByTherapist, confirmSessionByCustomer, cancelSession,
    getSessionById, getCustomerSessions, getTherapistSessions
} from "../services/session.service.js";
import { releasePayment } from "../services/payment.service.js";
import { logAction } from "../services/audit.service.js";

/**
 * Complete session by therapist
 */
const completeTherapistController = async (req, res, next) => {
    try {
        const { sessionId } = req.params;
        const therapistId = req.user.therapistProfile.id;
        const session = await completeSessionByTherapist(sessionId, therapistId);
        res.status(200).json({ success: true, data: session });
    } catch (error) {
        next(error);
    }
}

/**
 * Confirm session by customer and release payment
 */
const confirmByCustomerController = async (req, res, next) => {
    try {
        const { sessionId } = req.params;
        const customerId = req.user.customerProfile.id;
        const session = await confirmSessionByCustomer(sessionId, customerId);
        const payment = await releasePayment(sessionId);

        // Audit: customer-initiated payment release (most common payment flow)
        logAction({
            actorId: req.user.id,
            action: "payment.released",
            entityType: "payment",
            entityId: payment.id,
            changes: {
                trigger: "customer_confirmation",
                sessionId,
                amount: parseFloat(payment.therapistPayout),
                stripeTransferId: payment.stripeTransferId,
            },
        });

        res.status(200).json({ success: true, data: { session, payment } });
    } catch (error) {
        next(error);
    }
}

/**
 * Cancel session
 */
const cancelSessionController = async (req, res, next) => {
    try {
        const { sessionId } = req.params;
        const { reason } = req.body;
        const userId = req.user.id;
        const session = await cancelSession(sessionId, userId, reason);
        res.status(200).json({ success: true, data: session });
    } catch (error) {
        next(error);
    }
}

/**
 * Get session by ID
 */
const getSessionController = async (req, res, next) => {
    try {
        const { sessionId } = req.params;
        const userId = req.user.id;
        const session = await getSessionById(sessionId, userId);
        res.status(200).json({ success: true, data: session });
    } catch (error) {
        next(error);
    }
}

/**
 * Get customer sessions
 */
const getCustomerSessionsController = async (req, res, next) => {
    try {
        const customerId = req.user.customerProfile.id;
        const sessions = await getCustomerSessions(customerId);
        res.status(200).json({ success: true, data: sessions });
    } catch (error) {
        next(error);
    }
}

/**
 * Get therapist sessions
 */
const getTherapistSessionsController = async (req, res, next) => {
    try {
        const therapistId = req.user.therapistProfile.id;
        const sessions = await getTherapistSessions(therapistId);
        res.status(200).json({ success: true, data: sessions });
    } catch (error) {
        next(error);
    }
}

export {
    completeTherapistController,
    confirmByCustomerController,
    cancelSessionController,
    getSessionController,
    getCustomerSessionsController,
    getTherapistSessionsController,
};