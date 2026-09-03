import twilio from "twilio";
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";
import { prisma } from "../config/prisma.js";

const getClient = () => twilio(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN);

const SMS_OPT_OUT_NOTICE = "\nReply STOP to opt out.";

/**
 * @returns {boolean}
 */
const smsEnabled = () => {
    if (env.NODE_ENV === "test") return false;
    if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN || !env.TWILIO_MESSAGING_SERVICE_SID) {
        logger.warn("[SmsService] Twilio credentials not configured — SMS disabled");
        return false;
    }
    return true;
};

/**
 * Low-level send. Callers must already have verified smsOptIn and phone.
 * Appends STOP disclosure required by Twilio's Messaging Policy for toll-free traffic.
 * Sends via Messaging Service SID (not bare phone number) to enable Advanced Opt-Out.
 *
 * @param {{ to: string, body: string }} params
 * @returns {Promise<void>}
 */
export const sendSms = async ({ to, body }) => {
    const compliantBody = `${body}${SMS_OPT_OUT_NOTICE}`;

    if (!smsEnabled()) {
        logger.info("[SmsService] Skipping — credentials not configured or NODE_ENV=test");
        return;
    }

    if (!to.startsWith("+1")) {
        logger.warn("[SmsService] SMS BLOCKED – UNSUPPORTED COUNTRY", { to });
        return;
    }

    const message = await getClient().messages.create({
        messagingServiceSid: env.TWILIO_MESSAGING_SERVICE_SID,
        to,
        body: compliantBody,
    });

    logger.info("[SmsService] SMS sent", { sid: message.sid, status: message.status });
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
        logger.error(`[SmsService] ${triggerName} failed`, { error: err.message })
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


/**
 * Sync a STOP or START keyword event from Twilio's inbound webhook back to the DB.
 * Finds the matching CustomerProfile or TherapistProfile by phone and updates smsOptIn.
 * Safe to call multiple times — idempotent.
 *
 * @param {string} phone - E.164 phone number from Twilio's `From` field
 * @param {boolean} optIn - true for START, false for STOP
 * @returns {Promise<void>}
 */
export const syncTwilioOptStatus = async (phone, optIn) => {
    const [customerResult, therapistResult] = await Promise.allSettled([
        prisma.customerProfile.updateMany({ where: { phone }, data: { smsOptIn: optIn } }),
        prisma.therapistProfile.updateMany({ where: { phone }, data: { smsOptIn: optIn } }),
    ]);

    const customerCount = customerResult.status === "fulfilled" ? customerResult.value.count : 0;
    const therapistCount = therapistResult.status === "fulfilled" ? therapistResult.value.count : 0;
    const total = customerCount + therapistCount;

    if (total === 0) {
        logger.warn("[SmsService] Twilio opt status sync — no profile found for phone", { optIn });
    } else {
        logger.info("[SmsService] Twilio opt status synced", { optIn, customerCount, therapistCount });
    }
};

// ─── Therapist triggers ────────────────────────────────────────────────────
// SMS bodies: static copy, dates, and URLs only. Never free text, patient identifiers, or clinical detail (no Twilio BAA).

/**
 * Customer sent a direct request to this therapist.
 * @param {{ phone: string, smsOptIn: boolean }} therapistProfile
 * @param {string} requestId
 */
export const smsTherDirectOfferReceived = (therapistProfile, requestId) => {
    dispatch(
        therapistProfile,
        `You have a new direct service request on RehabTask. Open the app to review and respond: ${env.FRONTEND_URL}/therapist/requests/${requestId}`,
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

/**
 * Customer requested a revision on a session the therapist submitted.
 * @param {{ phone: string, smsOptIn: boolean }} therapistProfile
 * @param {string} bookingId
 */
export const smsTherRevisionRequested = (therapistProfile, bookingId) => {
    dispatch(
        therapistProfile,
        `A customer has requested changes to your session on RehabTask. Please review and set your revision date: ${env.FRONTEND_URL}/therapist/bookings/${bookingId}`,
        "therRevisionRequested"
    );
};

/**
 * Therapist's revision deadline is within 24h. Called by revisionExpirySms cron.
 * Uses dispatchAwaitable so the job can stamp revisionExpirySmsSentAt after send.
 * @param {{ phone: string, smsOptIn: boolean }} therapistProfile
 * @param {string} bookingId
 * @returns {Promise<boolean>}
 */
export const smsTherRevisionExpiringSoon = (therapistProfile, bookingId) => {
    return dispatchAwaitable(
        therapistProfile,
        `Reminder: your revision deadline expires in 24 hours on RehabTask. Please resubmit your session work: ${env.FRONTEND_URL}/therapist/bookings/${bookingId}`
    );
};

// ─── Customer triggers ─────────────────────────────────────────────────────

/**
 * Therapist submitted an offer on the customer's request.
 * @param {{ phone: string, smsOptIn: boolean }} customerProfile
 * @param {string} requestId
 */
export const smsCustOfferReceived = (customerProfile, requestId) => {
    dispatch(
        customerProfile,
        `A therapist has submitted an offer on your RehabTask request. Review it now: ${env.FRONTEND_URL}/customer/requests/${requestId}`,
        "custOfferReceived"
    );
};

/**
 * Therapist marked a session complete — customer needs to review.
 * @param {{ phone: string, smsOptIn: boolean }} customerProfile
 * @param {string} bookingId
 */
export const smsCustWorkSubmittedForReview = (customerProfile, bookingId) => {
    dispatch(
        customerProfile,
        `Your therapist has submitted a session for review on RehabTask. Please confirm or dispute within 72 hours: ${env.FRONTEND_URL}/customer/bookings/${bookingId}`,
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
 * @param {string} bookingId
 * @returns {Promise<boolean>}
 */
export const smsCustWorkReviewExpiring = (customerProfile, bookingId) => {
    return dispatchAwaitable(
        customerProfile,
        `Reminder: your session review window closes in 24 hours on RehabTask. Payment will release automatically if no action is taken: ${env.FRONTEND_URL}/customer/bookings/${bookingId}`
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

/**
 * Therapist extended their revision deadline.
 * @param {{ phone: string, smsOptIn: boolean }} customerProfile
 * @param {string} bookingId
 * @param {Date} newDueBy
 */
export const smsCustRevisionExtended = (customerProfile, bookingId, newDueBy) => {
    const formattedDate = new Date(newDueBy).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    dispatch(
        customerProfile,
        `Your therapist has extended their revision deadline to ${formattedDate} on RehabTask: ${env.FRONTEND_URL}/customer/bookings/${bookingId}`,
        "custRevisionExtended"
    );
};

/**
 * Customer notified their therapist's revision deadline is within 24h.
 * Same idempotency stamp as smsTherRevisionExpiringSoon — one stamp covers both sends.
 * @param {{ phone: string, smsOptIn: boolean }} customerProfile
 * @param {string} bookingId
 * @returns {Promise<boolean>}
 */
export const smsCustRevisionExpiringSoon = (customerProfile, bookingId) => {
    return dispatchAwaitable(
        customerProfile,
        `Your therapist's revision deadline expires in 24 hours on RehabTask. Check your booking for updates: ${env.FRONTEND_URL}/customer/bookings/${bookingId}`
    );
};