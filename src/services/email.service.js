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
    directRequestNotification,
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
    subscriptionUpgraded,
    subscriptionDowngraded,
    subscriptionResumed,
    subscriptionDowngradeScheduled,
    subscriptionPaymentActionRequired,
    offersWithdrawnRequestUpdated,
    existingAccountNotification,
    customerRefundAvailable,
    customerRefundReminder,
    customerRefundTransferred,
    customerRefundReturnedToCard,
    customerRefundPayoutFailed,
    attemptedVisitTherapistPayout,
    stripeRequirementsAlert,
    customerStripeRequirementsAlert,
    cancellationRequestedToTherapist,
    cancellationRequestedToCustomer,
    cancellationApprovedToCustomer,
    cancellationApprovedToTherapist,
    cancellationRejectedToCustomer,
    cancellationRejectedToTherapist,
    cancellationAutoApprovedToCustomer,
    cancellationAutoDeclinedToTherapist,
    sessionCancellationRequestedToOtherParty,
    sessionCancellationApprovedToRequester,
    sessionCancellationRejectedToRequester,
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
 * Direct therapy request created — notify the single targeted therapist only
 */
export const sendDirectRequestNotification = async ({ therapist, request }) => {
    return dispatch(therapist.user.email, directRequestNotification, { therapist, request });
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

export const sendStripeRequirementsAlert = async ({
    therapist, pastDueCount, currentlyDueCount, currentDeadline,
    hasUpcomingRequirements, futureDeadline,
}) => {
    return dispatch(therapist.user.email, stripeRequirementsAlert, {
        therapist, pastDueCount, currentlyDueCount, currentDeadline,
        hasUpcomingRequirements, futureDeadline,
    });
};

export const sendCustomerStripeRequirementsAlert = async ({
    customer, pastDueCount, currentlyDueCount, currentDeadline,
    hasUpcomingRequirements, futureDeadline,
}) => {
    return dispatch(customer.user.email, customerStripeRequirementsAlert, {
        customer, pastDueCount, currentlyDueCount, currentDeadline,
        hasUpcomingRequirements, futureDeadline,
    });
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

export const sendSubscriptionUpgraded = async ({ customer, subscription }) => {
    return dispatch(customer.user.email, subscriptionUpgraded, { customer, subscription });
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

// ── Customer Refund Emails ──

export const sendCustomerRefundAvailable = async ({ customer, therapist, refundAmount, bookingId }) => {
    return dispatch(customer.user.email, customerRefundAvailable, { customer, therapist, refundAmount, bookingId });
};

export const sendCustomerRefundReminder = async ({ customer, refundAmount }) => {
    return dispatch(customer.user.email, customerRefundReminder, { customer, refundAmount });
};

export const sendCustomerRefundTransferred = async ({ customer, refundAmount }) => {
    return dispatch(customer.user.email, customerRefundTransferred, { customer, refundAmount });
};

export const sendAttemptedVisitTherapistPayout = async ({ therapist, customer, session, booking, grossAmount, refundAmount }) => {
    return dispatch(therapist.user.email, attemptedVisitTherapistPayout, {
        therapist, customer, session, booking, grossAmount, refundAmount,
    });
};

export const sendCustomerRefundReturnedToCard = async ({ customer, refundAmount }) => {
    return dispatch(customer.user.email, customerRefundReturnedToCard, { customer, refundAmount });
};

export const sendCustomerRefundPayoutFailed = async ({ customer, refundAmount, reason }) => {
    return dispatch(customer.user.email, customerRefundPayoutFailed, { customer, refundAmount, reason });
};

/**
 * Customer resumed a cancelled subscription before period end.
 * @param {object} opts.customer - CustomerProfile with nested user
 * @param {object} opts.subscription - Subscription record
 */
export const sendSubscriptionResumed = async ({ customer, subscription }) => {
    return dispatch(customer.user.email, subscriptionResumed, { customer, subscription });
};

/**
 * Customer scheduled a plan downgrade — confirms the scheduled change.
 * @param {object} opts.customer - CustomerProfile with nested user
 * @param {object} opts.subscription - Subscription record
 * @param {string} opts.targetPlan - The plan the subscription will downgrade to
 */
export const sendSubscriptionDowngradeScheduled = async ({ customer, subscription, targetPlan }) => {
    return dispatch(customer.user.email, subscriptionDowngradeScheduled, { customer, subscription, targetPlan });
};

/**
 * Customer's subscription renewal requires 3DS verification (off-session).
 * Sends a hosted invoice URL so the customer can complete authentication.
 * @param {object} opts.customer - CustomerProfile with nested user
 * @param {string} opts.hostedInvoiceUrl - Stripe-hosted invoice URL for completing 3DS
 */
export const sendSubscriptionPaymentActionRequired = async ({ customer, hostedInvoiceUrl }) => {
    return dispatch(customer.user.email, subscriptionPaymentActionRequired, { customer, hostedInvoiceUrl });
};

export const sendCancellationRequestedToTherapist = async ({ therapist, customer, booking, reason }) =>
    dispatch(therapist.user.email, cancellationRequestedToTherapist, { therapist, customer, booking, reason });

export const sendCancellationRequestedToCustomer = async ({ therapist, customer, booking, reason }) =>
    dispatch(customer.user.email, cancellationRequestedToCustomer, { therapist, customer, booking, reason });

export const sendCancellationApprovedToCustomer = async ({ customer, therapist, booking, refundAmount, refundMethod }) =>
    dispatch(customer.user.email, cancellationApprovedToCustomer, { customer, therapist, booking, refundAmount, refundMethod });

export const sendCancellationApprovedToTherapist = async ({ customer, therapist, booking, refundAmount }) =>
    dispatch(therapist.user.email, cancellationApprovedToTherapist, { customer, therapist, booking, refundAmount });

export const sendCancellationRejectedToCustomer = async ({ customer, therapist, booking, rejectionReason }) =>
    dispatch(customer.user.email, cancellationRejectedToCustomer, { customer, therapist, booking, rejectionReason });

export const sendCancellationRejectedToTherapist = async ({ customer, therapist, booking, rejectionReason }) =>
    dispatch(therapist.user.email, cancellationRejectedToTherapist, { customer, therapist, booking, rejectionReason });

export const sendCancellationAutoApprovedToCustomer = async ({ customer, therapist, booking, refundAmount, refundMethod }) =>
    dispatch(customer.user.email, cancellationAutoApprovedToCustomer, { customer, therapist, booking, refundAmount, refundMethod });

export const sendCancellationAutoDeclinedToTherapist = async ({ customer, therapist, booking }) =>
    dispatch(therapist.user.email, cancellationAutoDeclinedToTherapist, { customer, therapist, booking });

export const sendSessionCancellationRequestedToOtherParty = async ({ recipient, requester, session, booking, reason, deadlineStr }) =>
    dispatch(recipient.user.email, sessionCancellationRequestedToOtherParty, { recipient, requester, session, booking, reason, deadlineStr });

export const sendSessionCancellationApprovedToRequester = async ({ requester, session, refundAmount, refundMethod }) =>
    dispatch(requester.user.email, sessionCancellationApprovedToRequester, { requester, session, refundAmount, refundMethod });

export const sendSessionCancellationRejectedToRequester = async ({ requester, session, rejectionReason }) =>
    dispatch(requester.user.email, sessionCancellationRejectedToRequester, { requester, session, rejectionReason });
