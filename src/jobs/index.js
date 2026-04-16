import { runSessionReminders } from "./sessionReminders.js";
import { runExpireOffers } from "./expireOffers.js";
import { runAutoConfirm } from "./autoConfirm.js";
import { runPaymentReminders } from "./paymentReminders.js";
import { runSubscriptionCron } from "./subscriptionCron.js";
import { runExpiredRefunds } from "./expiredRefunds.js";
import { logger } from "../config/logger.js";

const ONE_HOUR_MS = 60 * 60 * 1000;
const FIFTEEN_MIN_MS = 15 * 60 * 1000;
const SIX_HOURS_MS = 6 * 60 * 60 * 1000;

/**
 * Start all scheduled jobs.
 * Called once from server.js after the app is listening
 *
 * Uses setInterval since node-cron is not installed
 * Each job is wrapped in try/catch so a failure never crashes the server
 */
export const startScheduledJobs = () => {
    logger.info('[Jobs] Starting scheduled jobs');

    // Session reminders - every 1 hour
    setInterval(async () => {
        try {
            await runSessionReminders();
        } catch (error) {
            logger.error('[Jobs] Session reminders failed', { error: error.message });
        }
    }, ONE_HOUR_MS);

    // Offer expiry - every 15 minutes
    setInterval(async () => {
        try {
            await runExpireOffers();
        } catch (error) {
            logger.error('[Jobs] Expire offers failed', { error: error.message });
        }
    }, FIFTEEN_MIN_MS);

    // Auto-confirm - every 1 hour
    setInterval(async () => {
        try {
            await runAutoConfirm();
        } catch (error) {
            logger.error('[Jobs] Auto-confirm failed', { error: error.message });
        }
    }, ONE_HOUR_MS);

    // Payment reminders - every 1 hour
    setInterval(async () => {
        try {
            await runPaymentReminders();
        } catch (error) {
            logger.error('[Jobs] Payment reminders failed', { error: error.message });
        }
    }, ONE_HOUR_MS);

    // Subscription cron (trial expiry, grace period expiry) - every 1 hour
    setInterval(async () => {
        try {
            await runSubscriptionCron();
        } catch (error) {
            logger.error('[Jobs] Subscription cron failed', { error: error.message });
        }
    }, ONE_HOUR_MS);

    // Expired refund fallback (pending_connect → card refund after 30 days) - every 6 hours
    setInterval(async () => {
        try {
            await runExpiredRefunds();
        } catch (error) {
            logger.error('[Jobs] Expired refunds cron failed', { error: error.message });
        }
    }, SIX_HOURS_MS);

    // Run all once at startup (after a short delay to let DB connect)
    setTimeout(async () => {
        try { await runSessionReminders(); } catch (e) { logger.error('[Jobs] Startup sessionReminders failed', { error: e.message }); }
        try { await runExpireOffers(); } catch (e) { logger.error('[Jobs] Startup expireOffers failed', { error: e.message }); }
        try { await runAutoConfirm(); } catch (e) { logger.error('[Jobs] Startup autoConfirm failed', { error: e.message }); }
        try { await runPaymentReminders(); } catch (e) { logger.error('[Jobs] Startup paymentReminders failed', { error: e.message }); }
        try { await runSubscriptionCron(); } catch (e) { logger.error('[Jobs] Startup subscriptionCron failed', { error: e.message }); }
        try { await runExpiredRefunds(); } catch (e) { logger.error('[Jobs] Startup expiredRefunds failed', { error: e.message }); }
    }, 10_000);

    logger.info('[Jobs] Scheduled: sessionReminders (1h), expireOffers (15m), autoConfirm (1h), paymentReminders (1h), subscriptionCron (1h), expiredRefunds (6h)');
}