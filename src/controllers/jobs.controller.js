import { runSessionReminders } from "../jobs/sessionReminders.js";
import { runExpireOffers } from "../jobs/expireOffers.js";
import { runAutoConfirm } from "../jobs/autoConfirm.js";
import { runPaymentReminders } from "../jobs/paymentReminders.js";
import { runSubscriptionCron } from "../jobs/subscriptionCron.js";
import { runExpiredRefunds } from "../jobs/expiredRefunds.js";
import { runRetryPendingRefunds } from "../jobs/retryPendingRefunds.js";
import { runCancellationExpiry } from "../jobs/cancellationExpiry.js";
import { runSessionCancellationExpiry } from "../jobs/sessionCancellationExpiry.js";
import { runPurgeWebhookEvents } from "../jobs/purgeWebhookEvents.js";
import { runReviewExpirySms } from "../jobs/reviewExpirySms.js";
import { runRevisionExpirySms } from "../jobs/revisionExpirySms.js";
import { runPendingPaymentExpiry } from "../jobs/pendingPaymentExpiry.js";
import { logger } from "../config/logger.js";

const runJob = (name, fn) => async (req, res) => {
    logger.info(`[Jobs] ${name} triggered by Cloud Scheduler`);
    try {
        await fn();
        res.status(200).json({ success: true, job: name });
    } catch (error) {
        logger.error(`[Jobs] ${name} failed`, { error: error.message });
        res.status(500).json({ success: false, job: name, error: error.message });
    }
};

export const triggerSessionReminders = runJob("session-reminders", runSessionReminders);
export const triggerExpireOffers = runJob("expire-offers", runExpireOffers);
export const triggerAutoConfirm = runJob("auto-confirm", runAutoConfirm);
export const triggerPaymentReminders = runJob("payment-reminders", runPaymentReminders);
export const triggerSubscriptionCron = runJob("subscription-cron", runSubscriptionCron);
export const triggerExpiredRefunds = runJob("expired-refunds", runExpiredRefunds);
export const triggerRetryPendingRefunds = runJob("retry-pending-refunds", runRetryPendingRefunds);
export const triggerCancellationExpiry = runJob("cancellation-expiry", runCancellationExpiry);
export const triggerSessionCancellationExpiry = runJob("session-cancellation-expiry", runSessionCancellationExpiry);
export const triggerPurgeWebhookEvents = runJob("purge-webhook-events", runPurgeWebhookEvents);
export const triggerReviewExpirySms = runJob("review-expiry-sms", runReviewExpirySms);
export const triggerRevisionExpirySms = runJob("revision-expiry-sms", runRevisionExpirySms);
export const triggerPendingPaymentExpiry = runJob("pending-payment-expiry", runPendingPaymentExpiry);
