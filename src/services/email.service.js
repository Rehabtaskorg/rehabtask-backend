import { sendMail } from "../config/mailer.js";
import { logger } from "../config/logger.js";
import { env } from "../config/env.js";

import {
    therapistRegistrationPendingAdmin,
    therapistRegistrationPendingTherapist,
    therapistApproved,
    therapistRejected,
    subscriptionActivated,
    newRequestNotification,
    newOfferNotification,
    offerAccepted,
    paymentConfirmation,
    sessionReminder,
    sessionCompletionRequest,
    sessionConfirmed,
    payoutConfirmation,
    newMessageNotification,
    offerDeclined,
    offerWithdrawn,
    offerChangeRequested,
    bookingRescheduleProposed,
    bookingRescheduleAccepted,
    bookingRescheduleDeclined
} from '../../emails/templates.js';

// Internal helper - renders template and dispatches. Never throws
const dispatch = async (to, templateFn, props) => {
    try {
        const { subject, html } = templateFn(props);
        return await sendMail({ to, subject, html });
    } catch (error) {
        logger.error('[EmailService] Dispatch failed', { to, error: error.message });
        return { success: false, error: error.message };
    }
};

export const sendTherapistRegistrationPendingAdmin = async ({ therapist, adminEmails }) => {
    const results = [];
    for (const email of adminEmails) {
        const result = await dispatch(email, therapistRegistrationPendingAdmin, { therapist });
        results.push(result);
    }
    return results;
}

/**
 * Therapist submitted registration
 */
export const sendTherapistRegistrationPending = async ({ therapist }) => {
    dispatch(env.ADMIN_EMAIL, therapistRegistrationPendingAdmin, { therapist }).catch(() => { });
    return dispatch(therapist.user.email, therapistRegistrationPendingTherapist, { therapist });
};

/**
 * Admin Approved therapist
 */
export const sendTherapistApproved = async ({ therapist }) => {
    return dispatch(therapist.user.email, therapistApproved, { therapist });
};

/**
 * Admin rejected therapist
 */
export const sendTherapistRejected = async ({ therapist, reason }) => {
    return dispatch(therapist.user.email, therapistRejected, { therapist, reason });
};

/**
 * Subscription activated (customer)
 */
export const sendSubscriptionActivated = async ({ customer, subscription }) => {
    return dispatch(customer.user.email, subscriptionActivated, { customer, subscription });
};

/**
 * New therapy request - notify matching therapists
 */
export const sendNewRequestNotifications = async ({ therapists, request, customer }) => {
    return Promise.allSettled(
        therapists.map((therapist) =>
            dispatch(therapist.user.email, newRequestNotification, { therapist, request, customer })
        )
    );
};

/**
 * Therapist submitted offer - notify customer
 */
export const sendNewOfferNotification = async ({ customer, therapist, offer, request }) => {
    return dispatch(customer.user.email, newOfferNotification, { customer, therapist, offer, request });
};

/**
 * Customer accepted offer - notify therapist
 */
export const sendOfferAccepted = async ({ therapist, customer, booking, offer }) => {
    return dispatch(therapist.user.email, offerAccepted, { therapist, customer, booking, offer });
};

/**
 * Payment captured - customer receipt
 */
export const sendPaymentConfirmation = async ({ customer, booking, payment }) => {
    return dispatch(customer.user.email, paymentConfirmation, { customer, booking, payment });
};

/**
 * Session reminder - 24h before, sent to both parties
 */
export const sendSessionReminder = async ({ recipient, booking, role }) => {
    const email = recipient.user?.email || recipient.email;
    return dispatch(email, sessionReminder, { recipient, booking, role });
};
/**
 * Therapist marked session complete - ask customer to confirm
 */
export const sendSessionCompletionRequest = async ({ customer, therapist, session, booking }) => {
    return dispatch(customer.user.email, sessionCompletionRequest, { customer, therapist, session, booking });
};

/**
 * Customer confirmed session - notify therapist
 */
export const sendSessionConfirmed = async ({ therapist, customer, session, booking }) => {
    return dispatch(therapist.user.email, sessionConfirmed, { therapist, customer, session, booking });
};

/**
 * Payout sent to therapist
 */
export const sendPayoutConfirmation = async ({ therapist, payment, booking }) => {
    return dispatch(therapist.user.email, payoutConfirmation, { therapist, payment, booking });
};

/**
 * New message notification (anti-spam: first-unread only)
 */
export const sendNewMessageNotification = async ({ recipient, senderName, message, contextType, contextId }) => {
    return dispatch(recipient.email, newMessageNotification, { recipient, senderName, message, contextType, contextId });
};

export const sendOfferDeclined = async ({ therapist, customer, offer }) => {
    return dispatch(therapist.user.email, offerDeclined, { therapist, customer, offer });
};

export const sendOfferWithdrawn = async ({ customer, therapist, offer }) => {
    return dispatch(customer.user.email, offerWithdrawn, { customer, therapist, offer });
};

export const sendOfferChangeRequested = async ({ therapist, customer, offer, note }) => {
    return dispatch(therapist.user.email, offerChangeRequested, { therapist, customer, offer, note });
};

export const sendBookingRescheduleProposed = async ({ customer, therapist, booking, newDate }) => {
    return dispatch(customer.user.email, bookingRescheduleProposed, { customer, therapist, booking, newDate });
};

export const sendBookingRescheduleAccepted = async ({ therapist, booking }) => {
    return dispatch(therapist.user.email, bookingRescheduleAccepted, { therapist, booking });
};

export const sendBookingRescheduleDeclined = async ({ therapist, booking, reason }) => {
    return dispatch(therapist.user.email, bookingRescheduleDeclined, { therapist, booking, reason });
};
