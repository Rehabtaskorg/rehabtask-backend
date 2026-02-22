import React from "react";
import { render } from "@react-email/render";
import { sendMail } from "../config/mailer.js";
import { logger } from "../config/logger.js";
import { env } from "../config/env.js";

import TherapistRegistrationPending from "../../emails/TherapistRegistrationPending.jsx";
import TherapistApproved from '../../emails/TherapistApproved.jsx';
import TherapistRejected from '../../emails/TherapistRejected.jsx';
import SubscriptionActivated from '../../emails/SubscriptionActivated.jsx';
import NewRequestNotification from '../../emails/NewRequestNotification.jsx';
import NewOfferNotification from '../../emails/NewOfferNotification.jsx';
import OfferAccepted from '../../emails/OfferAccepted.jsx';
import PaymentConfirmation from '../../emails/PaymentConfirmation.jsx';
import SessionReminder from '../../emails/SessionReminder.jsx';
import SessionCompletionRequest from '../../emails/SessionCompletionRequest.jsx';
import SessionConfirmed from '../../emails/SessionConfirmed.jsx';
import PayoutConfirmation from '../../emails/PayoutConfirmation.jsx';
import NewMessageNotification from '../../emails/NewMessageNotification.jsx';

// Interanl helper - renders template and dispatches. Never throws
const dispatch = async (to, subject, Component, props) => {
    try {
        const html = await render(React.createElement(Component, props));
        return await sendMail({ to, subject, html });
    } catch (error) {
        logger.error('[EmailService] Dispatch failed', { to, subject, error: error.message });
        return { success: false, error: error.message };
    }
};

/**
 * Therapist submitted registration
 */
export const sendTherapistRegistrationPending = async ({ therapist }) => {
    dispatch(
        env.ADMIN_EMAIL,
        "New Therapist Registration - Review required",
        TherapistRegistrationPending,
        { therapist, isAdmin: true }
    ).catch(() => { });

    return dispatch(
        therapist.user.email,
        "Your RehabTask application has been received",
        TherapistRegistrationPending,
        { therapist, isAdmin: false }
    );
};

/**
 * Admin Approved therapist
 */
export const sendTherapistApproved = async ({ therapist }) => {
    return dispatch(
        therapist.user.email,
        'Congratulations — Your RehabTask profile is approved',
        TherapistApproved,
        { therapist }
    );
};

/**
 * Admin rejected therapist
 */
export const sendTherapistRejected = async ({ therapist, reason }) => {
    return dispatch(
        therapist.user.email,
        'Update on your RehabTask application',
        TherapistRejected,
        { therapist, reason }
    );
};

/**
 * Subscription activated (customer)
 */
export const sendSubscriptionActivated = async ({ customer, subscription }) => {
    return dispatch(
        customer.user.email,
        'Your RehabTask subscription is active',
        SubscriptionActivated,
        { customer, subscription }
    );
};

/**
 * New therapy request - notify matching therapists
 */
export const sendNewRequestNotifications = async ({ therapists, request, customer }) => {
    return Promise.allSettled(
        therapists.map((therapist) =>
            dispatch(
                therapist.user.email,
                'New therapy request in your area',
                NewRequestNotification,
                { therapist, request, customer }
            )
        )
    );
};

/**
 * Therapist submitted offer - notify customer
 */
export const sendNewOfferNotification = async ({ customer, therapist, offer, request }) => {
    return dispatch(
        customer.user.email,
        `${therapist.fullName} sent you a therapy offer`,
        NewOfferNotification,
        { customer, therapist, offer, request }
    );
}

/**
 * Customer accepted offer - notify therapist
 */
export const sendOfferAccepted = async ({ therapist, customer, booking, offer }) => {
    return dispatch(
        therapist.user.email,
        'Your offer has been accepted — booking confirmed',
        OfferAccepted,
        { therapist, customer, booking, offer }
    );
}

/**
 * Payment captured - customer receipt
 */
export const sendPaymentConfirmation = async ({ customer, booking, payment }) => {
    return dispatch(
        customer.user.email,
        'Payment confirmed — RehabTask receipt',
        PaymentConfirmation,
        { customer, booking, payment }
    );
}

/**
 * Session reminder - 24h before, sent to both parties
 */
export const sendSessionReminder = async ({ customer, therapist, booking }) => {
    dispatch(
        customer.user.email,
        "Reminder: Your therapy session is tomorrow",
        SessionReminder,
        { recipient: customer, booking, role: "customer" }
    ).catch(() => { });

    return dispatch(
        therapist.user.email,
        `Reminder: Session with ${customer.fullName} is tomorrow`,
        SessionReminder,
        { recipient: therapist, booking, role: 'therapist' }
    );
}

/**
 * Therapist marked session complete - ask customer to confirm
 */
export const sendSessionCompletionRequest = async ({ customer, therapist, session, booking }) => {
    return dispatch(
        customer.user.email,
        `${therapist.fullName} marked your session as complete — please confirm`,
        SessionCompletionRequest,
        { customer, therapist, session, booking }
    );
}

/**
 * Customer confirmed session - notify therapist
 */
export const sendSessionConfirmed = async ({ therapist, customer, session, booking }) => {
    return dispatch(
        therapist.user.email,
        'Session confirmed by customer — payout in progress',
        SessionConfirmed,
        { therapist, customer, session, booking }
    );
}

/**
 * Payout sent to therapist
 */
export const sendPayoutConfirmation = async ({ therapist, payment, booking }) => {
    return dispatch(
        therapist.user.email,
        'Your payout has been sent',
        PayoutConfirmation,
        { therapist, payment, booking }
    );
}

/**
 * New message notification (anti-spam: first-unread only)
 */
export const sendNewMessageNotification = async ({ recipient, senderName, message, contextType, contextId }) => {
    return dispatch(
        recipient.email,
        `New message from ${senderName}`,
        NewMessageNotification,
        { recipient, senderName, message, contextType, contextId, frontendUrl: env.FRONTEND_URL }
    );
}