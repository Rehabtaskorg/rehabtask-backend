import {
    completeSessionByTherapist, confirmSessionByCustomer, cancelSession,
    getSessionById, getCustomerSessions, getTherapistSessions, scheduleSession,
    requestSessionRevision, submitSessionRevision,
    respondToRevision, resubmitSession, extendRevision,
    markSessionMissed,
    markSessionAttempted,
} from "../services/session.service.js";

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

        // Payment release is now handled inside confirmSessionByCustomer
        // (only triggers when ALL sessions for the booking are confirmed)
        res.status(200).json({ success: true, data: { session } });
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

/**
 * Customer requests revision on a completed session
 */
const requestRevisionController = async (req, res, next) => {
    try {
        const { sessionId } = req.params;
        const { reason } = req.body;
        const customerId = req.user.customerProfile.id;
        const session = await requestSessionRevision(sessionId, customerId, reason);
        res.status(200).json({ success: true, data: session });
    } catch (error) {
        next(error);
    }
}

/**
 * Therapist resubmits a session after addressing revision
 */
const submitRevisionController = async (req, res, next) => {
    try {
        const { sessionId } = req.params;
        const { dueBy } = req.body;
        const therapistId = req.user.therapistProfile.id;
        const session = await submitSessionRevision(sessionId, therapistId, { dueBy });
        res.status(200).json({ success: true, data: session });
    } catch (error) {
        next(error);
    }
}

/**
 * Schedule a pending session (therapist sets the date)
 */
const scheduleSessionController = async (req, res, next) => {
    try {
        const { sessionId } = req.params;
        const { scheduledDate } = req.body;
        const therapistId = req.user.therapistProfile.id;
        const session = await scheduleSession(sessionId, therapistId, scheduledDate);
        res.status(200).json({ success: true, data: session });
    } catch (error) {
        next(error);
    }
}

/**
 * Step 1: Therapist responds to revision with a committed date
 */
const respondToRevisionController = async (req, res, next) => {
    try {
        const { sessionId } = req.params;
        const { dueBy } = req.body;
        const therapistId = req.user.therapistProfile.id;
        const session = await respondToRevision(sessionId, therapistId, { dueBy });
        res.status(200).json({ success: true, data: session });
    } catch (error) {
        next(error);
    }
};

/**
 * Step 2: Therapist resubmits the session after completing the revision
 */
const resubmitSessionController = async (req, res, next) => {
    try {
        const { sessionId } = req.params;
        const therapistId = req.user.therapistProfile.id;
        const session = await resubmitSession(sessionId, therapistId);
        res.status(200).json({ success: true, data: session });
    } catch (error) {
        next(error);
    }
};

/**
 * Therapist extends the revision deadline by a fixed number of days.
 * New deadline = max(currentDueBy, now) + REVISION_EXTEND_DAYS.
 */
const extendRevisionController = async (req, res, next) => {
    try {
        const { sessionId } = req.params;
        const therapistId = req.user.therapistProfile.id;
        const session = await extendRevision(sessionId, therapistId);
        res.status(200).json({ success: true, data: session });
    } catch (error) {
        next(error);
    }
};

/**
 * Therapist: self-report they couldn't attend a scheduled session.
 * Creates a per-session refund for the customer.
 */
const markMissedByTherapistController = async (req, res, next) => {
    try {
        const { sessionId } = req.params;
        const { reason } = req.body;
        const result = await markSessionMissed(sessionId, req.user.id, "therapist", reason);
        res.status(200).json({ success: true, data: result });
    } catch (error) {
        next(error);
    }
};

/**
 * Customer: report a therapist no-show on a past scheduled session.
 * Creates a per-session refund.
 */
const markMissedByCustomerController = async (req, res, next) => {
    try {
        const { sessionId } = req.params;
        const { reason } = req.body;
        const result = await markSessionMissed(sessionId, req.user.id, "customer", reason);
        res.status(200).json({ success: true, data: result });
    } catch (error) {
        next(error);
    }
};

/**
 * Therapist: record an attempted visit (arrived but patient not home).
 * Splits escrowed funds between therapist (attemptedVisitRate) and customer refund
 * (booking.rate - attemptedVisitRate). Session closes in 'attempted' state.
 */
const markAttemptedByTherapistController = async (req, res, next) => {
    try {
        const { sessionId } = req.params;
        const { reason } = req.body;
        const result = await markSessionAttempted(sessionId, req.user.id, reason);
        res.status(200).json({ success: true, data: result });
    } catch (error) {
        next(error);
    }
};

export {
    completeTherapistController,
    confirmByCustomerController,
    cancelSessionController,
    getSessionController,
    getCustomerSessionsController,
    getTherapistSessionsController,
    scheduleSessionController,
    requestRevisionController,
    submitRevisionController,
    respondToRevisionController,
    resubmitSessionController,
    extendRevisionController,
    markMissedByTherapistController,
    markMissedByCustomerController,
    markAttemptedByTherapistController,
};