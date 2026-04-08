import { sendMail } from "../config/mailer.js";
import { logger } from "../config/logger.js";
import { env } from "../config/env.js";

import {
    therapistWelcome,
    therapistApplicationSubmitted,
    therapistApplicationSubmittedAdmin,
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
    sessionRevisionRequested,
    sessionRevisionSubmitted,
    payoutConfirmation,
    newMessageNotification,
    offerDeclined,
    offerWithdrawn,
    offerChangeRequested,
    bookingRescheduleProposed,
    bookingRescheduleAccepted,
    bookingRescheduleDeclined,
    disputeStatusUpdate,
    disputeReopened,
    accountDeactivated,
    paymentFailed,
    payoutFailed,
    adminPaymentReleased,
    adminPaymentRefunded,
    bookingCancelledByAdmin,
    subAdminWelcome,
    subscriptionCancelledByAdmin,
    commissionRateChanged,
    paymentReleasedToCustomer,
    paymentReminder,
    trialExpiringSoon,
    trialExpired,
    subscriptionPaymentFailed,
    subscriptionCancelledByCustomer,
    subscriptionDowngraded,
    offersWithdrawnRequestUpdated,
    existingAccountNotification,
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

/**
 * Therapist created account — welcome email (no admin notification yet)
 */
export const sendTherapistWelcome = async ({ therapist }) => {
    return dispatch(therapist.user.email, therapistWelcome, { therapist });
};

/**
 * Therapist completed onboarding — notify both therapist and admin
 */
export const sendTherapistApplicationSubmitted = async ({ therapist }) => {
    dispatch(env.ADMIN_EMAIL, therapistApplicationSubmittedAdmin, { therapist }).catch(() => { });
    return dispatch(therapist.user.email, therapistApplicationSubmitted, { therapist });
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
 * Customer requested a revision on a session — notify therapist
 */
export const sendSessionRevisionRequested = async ({ therapist, customer, session, booking, reason }) => {
    return dispatch(therapist.user.email, sessionRevisionRequested, { therapist, customer, session, booking, reason });
};

/**
 * Therapist resubmitted session after revision — notify customer
 */
export const sendSessionRevisionSubmitted = async ({ customer, therapist, session, booking }) => {
    return dispatch(customer.user.email, sessionRevisionSubmitted, { customer, therapist, session, booking });
};

/**
 * Payout sent to therapist
 */
export const sendPayoutConfirmation = async ({ therapist, payment, booking }) => {
    return dispatch(therapist.user.email, payoutConfirmation, { therapist, payment, booking });
};

/**
 * Payment released — notify customer that funds have been transferred to therapist
 */
export const sendPaymentReleasedToCustomer = async ({ customer, therapist, payment, booking }) => {
    return dispatch(customer.user.email, paymentReleasedToCustomer, { customer, therapist, payment, booking });
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

export const sendOffersWithdrawnRequestUpdated = async ({ therapists, customer, request }) => {
    return Promise.allSettled(
        therapists.map((therapist) =>
            dispatch(therapist.user.email, offersWithdrawnRequestUpdated, { therapist, customer, request })
        )
    );
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

/**
 * Dispute status changed — notify the filer
 */
export const sendDisputeStatusUpdate = async ({ user, dispute, statusMessage }) => {
    return dispatch(user.email, disputeStatusUpdate, { user, dispute, statusMessage });
};

/**
 * Dispute reopened — notify the filer
 */
export const sendDisputeReopened = async ({ user, dispute }) => {
    return dispatch(user.email, disputeReopened, { user, dispute });
};

/**
 * Payment failed — notify customer
 */
export const sendPaymentFailed = async ({ customer, booking, reason }) => {
    return dispatch(customer.user.email, paymentFailed, { customer, booking, reason });
};

/**
 * Payout failed — notify therapist
 */
export const sendPayoutFailed = async ({ therapist, amount, reason }) => {
    return dispatch(therapist.user.email, payoutFailed, { therapist, amount, reason });
};

/**
 * Admin released payment — notify therapist
 */
export const sendAdminPaymentReleased = async ({ therapist, amount, booking }) => {
    return dispatch(therapist.user.email, adminPaymentReleased, { therapist, amount, booking });
};

/**
 * Admin refunded payment — notify customer
 */
export const sendAdminPaymentRefunded = async ({ customer, amount, booking, reason }) => {
    return dispatch(customer.user.email, adminPaymentRefunded, { customer, amount, booking, reason });
};

/**
 * Booking cancelled by admin — notify a participant
 */
export const sendBookingCancelledByAdmin = async ({ recipientEmail, recipientName, booking, reason, role }) => {
    return dispatch(recipientEmail, bookingCancelledByAdmin, { recipientName, booking, reason, role });
};

export const sendAccountDeactivated = async ({ user }) => {
    const displayName =
        user.customerProfile?.fullName ||
        user.therapistProfile?.fullName ||
        user.email.split('@')[0];
    return dispatch(user.email, accountDeactivated, { user: { ...user, displayName } });
};

export const sendSubAdminWelcome = async ({ user }) => {
    return dispatch(user.email, subAdminWelcome, { user });
};

export const sendSubscriptionCancelledByAdmin = async ({ customer, subscription }) => {
    return dispatch(customer.user.email, subscriptionCancelledByAdmin, { customer, subscription });
};

export const sendCommissionRateChanged = async ({ therapists, tier, oldRate, newRate, effectiveFrom }) => {
    return Promise.allSettled(
        therapists.map((therapist) =>
            dispatch(therapist.user.email, commissionRateChanged, { therapist, tier, oldRate, newRate, effectiveFrom })
        )
    );
};

export const sendPaymentReminder = async ({ customer, therapist, booking, hoursUntilSession }) => {
    return dispatch(customer.user.email, paymentReminder, { customer, therapist, booking, hoursUntilSession });
};

export const sendTrialExpiringSoon = async ({ customer, daysLeft }) => {
    return dispatch(customer.user.email, trialExpiringSoon, { customer, daysLeft });
};

export const sendTrialExpired = async ({ customer }) => {
    return dispatch(customer.user.email, trialExpired, { customer });
};

export const sendSubscriptionPaymentFailed = async ({ customer }) => {
    return dispatch(customer.user.email, subscriptionPaymentFailed, { customer });
};

export const sendSubscriptionCancelledByCustomer = async ({ customer, subscription }) => {
    return dispatch(customer.user.email, subscriptionCancelledByCustomer, { customer, subscription });
};

export const sendSubscriptionDowngraded = async ({ customer }) => {
    return dispatch(customer.user.email, subscriptionDowngraded, { customer });
};

/**
 * Existing account notification — sent when someone tries to register
 * with an email that already has an account. Prevents email enumeration
 * while informing the existing user.
 */
export const sendExistingAccountNotification = async ({ email, resetLink }) => {
    return dispatch(email, existingAccountNotification, { email, resetLink });
};
