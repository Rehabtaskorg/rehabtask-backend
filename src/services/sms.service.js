import twilio from "twilio";
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";

const getClient = () => twilio(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN);

/**
 * @returns {boolean}
 */
const smsEnabled = () => {
    if (env.NODE_ENV === "test") return false;
    if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN || !env.TWILIO_PHONE_NUMBER) {
        logger.warn("[SmsService] Twilio credentials not configured — SMS disabled");
        return false;
    }
    return true;
};

/**
 * Low-level send. Callers must already have verified smsOptIn and phone.
 * Fire-and-forget safe — always .catch() at the call site.
 *
 * @param {{ to: string, body: string }} params
 * @returns {Promise<void>}
 */
export const sendSms = async ({ to, body }) => {
    if (!smsEnabled()) {
        logger.info("[SmsService] Skipping — credentials not configured or NODE_ENV=test", { body });
        return;
    }

    const message = await getClient().messages.create({
        from: env.TWILIO_PHONE_NUMBER,
        to,
        body,
    });

    logger.info("[SmsService] SMS sent", { sid: message.sid, status: message.status, to });
};

/**
 * Fire-and-forget dispatch for inline request/response triggers.
 * Never throws — callers are not async-aware.
 *
 * @param {{ phone: string|null|undefined, smsOptIn: boolean|null|undefined }} profile
 * @param {string} body
 * @param {string} triggerName
 */
const dispatch = (profile, body, triggerName) => {
    if (!profile?.smsOptIn || !profile?.phone) return;
    sendSms({ to: profile.phone, body }).catch((err) =>
        logger.error(`[SmsService] ${triggerName} failed`, { error: err.message, phone: profile.phone })
    );
};

/**
 * Awaitable dispatch for scheduled jobs that need to know whether the send
 * succeeded before writing state (e.g. reviewExpirySmsSentAt).
 * Resolves to true if sent, false if skipped (no consent/phone). Throws on Twilio error.
 *
 * @param {{ phone: string|null|undefined, smsOptIn: boolean|null|undefined }} profile
 * @param {string} body
 * @returns {Promise<boolean>}
 */
const dispatchAwaitable = async (profile, body) => {
    if (!profile?.smsOptIn || !profile?.phone) return false;
    await sendSms({ to: profile.phone, body });
    return true;
};

// ─── Therapist triggers ────────────────────────────────────────────────────

/**
 * Customer sent a direct request to this therapist.
 * @param {{ phone: string, smsOptIn: boolean }} therapistProfile
 */
export const smsTherDirectOfferReceived = (therapistProfile) => {
    dispatch(
        therapistProfile,
        `You have a new direct service request on RehabTask. Open the app to review and respond: ${env.FRONTEND_URL}/therapist/requests`,
        "therDirectOfferReceived"
    );
};

/**
 * Payment released to therapist after session confirmed.
 * @param {{ phone: string, smsOptIn: boolean }} therapistProfile
 */
export const smsTherPaymentReleased = (therapistProfile) => {
    dispatch(
        therapistProfile,
        `Your payment for a completed session has been released. Check your RehabTask account: ${env.FRONTEND_URL}/therapist/earnings`,
        "therPaymentReleased"
    );
};

/**
 * New unread chat message for therapist.
 * @param {{ phone: string, smsOptIn: boolean }} therapistProfile
 */
export const smsTherNewMessage = (therapistProfile) => {
    dispatch(
        therapistProfile,
        `You have a new message on RehabTask. Open the app to reply: ${env.FRONTEND_URL}/therapist/messages`,
        "therNewMessage"
    );
};

// ─── Customer triggers ─────────────────────────────────────────────────────

/**
 * Therapist submitted an offer on the customer's request.
 * @param {{ phone: string, smsOptIn: boolean }} customerProfile
 */
export const smsCustOfferReceived = (customerProfile) => {
    dispatch(
        customerProfile,
        `A therapist has submitted an offer on your RehabTask request. Review it now: ${env.FRONTEND_URL}/customer/requests`,
        "custOfferReceived"
    );
};

/**
 * Therapist marked a session complete — customer needs to review.
 * @param {{ phone: string, smsOptIn: boolean }} customerProfile
 */
export const smsCustWorkSubmittedForReview = (customerProfile) => {
    dispatch(
        customerProfile,
        `Your therapist has submitted a session for review on RehabTask. Please confirm or dispute within 72 hours: ${env.FRONTEND_URL}/customer/sessions`,
        "custWorkSubmittedForReview"
    );
};

/**
 * Warning: 24 hours until the review window closes and payment auto-releases.
 * Called by the review-expiry-sms Cloud Scheduler job — awaitable so the job
 * can stamp reviewExpirySmsSentAt only after a confirmed send attempt.
 * Returns true if sent, false if skipped (opted out / no phone). Throws on Twilio error.
 *
 * @param {{ phone: string, smsOptIn: boolean }} customerProfile
 * @returns {Promise<boolean>}
 */
export const smsCustWorkReviewExpiring = (customerProfile) => {
    return dispatchAwaitable(
        customerProfile,
        `Reminder: your session review window closes in 24 hours on RehabTask. Payment will release automatically if no action is taken: ${env.FRONTEND_URL}/customer/sessions`
    );
};

/**
 * New unread chat message for customer.
 * @param {{ phone: string, smsOptIn: boolean }} customerProfile
 */
export const smsCustNewMessage = (customerProfile) => {
    dispatch(
        customerProfile,
        `You have a new message on RehabTask. Open the app to reply: ${env.FRONTEND_URL}/customer/messages`,
        "custNewMessage"
    );
};
