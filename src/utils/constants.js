// ─── User Roles ───────────────────────────────────────────────────────────────
export const USER_ROLES = {
    CUSTOMER:  "customer",
    THERAPIST: "therapist",
    ADMIN:     "admin",
    SUB_ADMIN: "sub_admin",
};

// ─── Customer Types ───────────────────────────────────────────────────────────
export const CUSTOMER_TYPES = {
    AGENCY: "agency",
};

// ─── Approval Status ──────────────────────────────────────────────────────────
export const APPROVAL_STATUS = {
    PENDING:  "pending",
    REVIEW:   "review",
    APPROVED: "approved",
    REJECTED: "rejected",
};

// ─── Booking Status ───────────────────────────────────────────────────────────
export const BOOKING_STATUS = {
    PENDING:              "pending",
    ACCEPTED:             "accepted",
    CONFIRMED:            "confirmed",
    IN_PROGRESS:          "in_progress",
    RESCHEDULE_REQUESTED: "reschedule_requested",
    FINALIZED:            "finalized",
    COMPLETED:            "completed",
    CANCELLED:            "cancelled",
};

// ─── Session Status ───────────────────────────────────────────────────────────
export const SESSION_STATUS = {
    PENDING_SCHEDULE:      "pending_schedule",
    SCHEDULED:             "scheduled",
    IN_PROGRESS:           "in_progress",
    CONFIRMED_BY_CUSTOMER: "confirmed_by_customer",
    MISSED:                "missed",
    ATTEMPTED:             "attempted",
    CANCELLED:             "cancelled",
    COMPLETED:             "completed",
};

// ─── Offer Status ─────────────────────────────────────────────────────────────
export const OFFER_STATUS = {
    PENDING:          "pending",
    ACCEPTED:         "accepted",
    REJECTED:         "rejected",
    CHANGE_REQUESTED: "change_requested",
    CANCELLED:        "cancelled",
};

// ─── Subscription Status ──────────────────────────────────────────────────────
export const SUBSCRIPTION_STATUS = {
    ACTIVE:       "active",
    INACTIVE:     "inactive",
    TRIALING:     "trialing",
    GRACE_PERIOD: "grace_period",
    PAST_DUE:     "past_due",
    CANCELLED:    "cancelled",
};

// ─── Refund / Payment Status ──────────────────────────────────────────────────
export const REFUND_STATUS = {
    PENDING:   "pending",
    COMPLETED: "completed",
    FAILED:    "failed",
    CANCELLED: "cancelled",
};

// ─── Background Check Status ──────────────────────────────────────────────────
export const BACKGROUND_CHECK_STATUS = {
    PENDING:  "pending",
    APPROVED: "approved",
    REJECTED: "rejected",
};

// ─── Time (milliseconds) ──────────────────────────────────────────────────────
export const TIME_MS = {
    ONE_MINUTE:    60 * 1000,
    FIFTEEN_MIN:   15 * 60 * 1000,
    TEN_MIN:       10 * 60 * 1000,
    ONE_HOUR:      60 * 60 * 1000,
    SIX_HOURS:     6  * 60 * 60 * 1000,
    TWENTY_HOURS:  20 * 60 * 60 * 1000,
    TWENTY_THREE_HOURS: 23 * 60 * 60 * 1000,
    TWENTY_FOUR_HOURS:  24 * 60 * 60 * 1000,
    TWENTY_FIVE_HOURS:  25 * 60 * 60 * 1000,
    FORTY_EIGHT_HOURS:  48 * 60 * 60 * 1000,
    SEVEN_DAYS:    7  * 24 * 60 * 60 * 1000,
};

// Number of days added to the revision deadline on each therapist "Extend" action.
// Uses max(currentDueBy, now) + this value so early extensions always move the deadline forward.
export const REVISION_EXTEND_DAYS = 3;

// ─── Rate Limiter ─────────────────────────────────────────────────────────────
export const RATE_LIMIT = {
    API_WINDOW_MS:           15 * 60 * 1000,  // 15 minutes
    API_MAX_PROD:            100,
    API_MAX_DEV:             10000,

    SENSITIVE_WINDOW_MS:     60 * 60 * 1000,  // 1 hour
    SENSITIVE_MAX_PROD:      10,
    SENSITIVE_MAX_DEV:       1000,

    AUTH_WINDOW_MS:          60 * 60 * 1000,  // 1 hour
    AUTH_MAX_PROD:           10,
    AUTH_MAX_DEV:            1000,

    SOCKET_WINDOW_MS:        15 * 60 * 1000,  // 15 minutes
    SOCKET_MAX_PROD:         600,
    SOCKET_MAX_DEV:          10000,

    UPLOAD_WINDOW_MS:        60 * 60 * 1000,  // 1 hour
    UPLOAD_MAX_PROD:         20,
    UPLOAD_MAX_DEV:          1000,

    MESSAGE_WINDOW_MS:       60 * 1000,        // 1 minute
    MESSAGE_MAX_PROD:        20,
    MESSAGE_MAX_DEV:         1000,
};

// ─── Cookie Max-Age ───────────────────────────────────────────────────────────
export const COOKIE_MAX_AGE = {
    ONE_HOUR:  60 * 60 * 1000,
    SEVEN_DAYS: 7 * 24 * 60 * 60 * 1000,
};

// ─── Misc ─────────────────────────────────────────────────────────────────────
export const NOTIFICATION_DEDUP_WINDOW_MS = 60 * 1000; // 60 seconds
export const ZIP_CACHE_TTL_MS             = 24 * 60 * 60 * 1000;
export const ONE_HOUR_AGO_MS              = 60 * 60 * 1000;
export const REPORT_MS_PER_DAY           = 1000 * 60 * 60 * 24;