/**
 * Event types for system monitoring and observability
 */

export const EVENT_TYPES = {
    // Therapist Events
    THERAPIST_REGISTRATION_SUBMITTED: "therapist.registration.submitted",
    THERAPIST_APPROVED: "therapist.approved",
    THERAPIST_REJECTED: "therapist.rejected",

    // Subscription Events
    SUBSCRIPTION_ACTIVATED: "subscription.activated",
    SUBSCRIPTION_FAILED: "subscription.failed",
    SUBSCRIPTION_CANCELLED: "subscription.cancelled",
    SUBSCRIPTION_PAST_DUE: "subscription.past_due",

    // Request Events
    REQUEST_CREATED: "request.created",
    REQUEST_THERAPIST_MATCH: "request.therapist_match",
    REQUEST_CANCELLED: "request.cancelled",

    // Offer Events
    OFFER_SENT: "offer.sent",
    OFFER_ACCEPTED: "offer.accepted",
    OFFER_REJECTED: "offer.rejected",
    OFFER_EXPIRED: "offer.expired",

    // Payment Events
    PAYMENT_INTENT_CREATED: "payment.intent_created",
    PAYMENT_ESCROWED: "payment.escrowed",
    PAYMENT_FAILED: "payment.failed",
    PAYMENT_REFUNDED: "payment.refunded",

    // Session Events
    SESSION_SCHEDULED: "session.scheduled",
    SESSION_COMPLETED_BY_THERAPIST: "session.completed_by_therapist",
    SESSION_CONFIRMED_BY_CUSTOMER: "session.confirmed_by_customer",
    SESSION_AUTO_CONFIRMED: "session.auto_confirmed",
    SESSION_CANCELLED: "session.cancelled",

    // Payout Events
    PAYOUT_RELEASED: "payout.released",
    PAYOUT_FAILED: "payout.failed",

    // Email Events
    EMAIL_SENT: "email.sent",
    EMAIL_FAILED: "email.failed",

    // API Events
    API_REQUEST: "api.request",
    API_ERROR: "api.error",

    // Auth Events
    USER_LOGIN: "user.login",
    USER_LOGOUT: "user.logout",
    USER_LOGIN_FAILED: "user.login_failed",

    // Admin Events
    ADMIN_ACTION: "admin.action"

}