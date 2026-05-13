import { TIME_MS } from "../utils/constants.js";
import { runSessionReminders } from "./sessionReminders.js";
import { runExpireOffers } from "./expireOffers.js";
import { runAutoConfirm } from "./autoConfirm.js";
import { runPaymentReminders } from "./paymentReminders.js";
import { runSubscriptionCron } from "./subscriptionCron.js";
import { runExpiredRefunds } from "./expiredRefunds.js";
import { runRetryPendingRefunds } from "./retryPendingRefunds.js";
import { logger } from "../config/logger.js";

export const startScheduledJobs = () => {
    logger.info('[Jobs] Starting scheduled jobs');

    setInterval(async () => {
        try { await runSessionReminders(); }
        catch (error) { logger.error('[Jobs] Session reminders failed', { error: error.message }); }
    }, TIME_MS.ONE_HOUR);

    setInterval(async () => {
        try { await runExpireOffers(); }
        catch (error) { logger.error('[Jobs] Expire offers failed', { error: error.message }); }
    }, TIME_MS.FIFTEEN_MIN);

    setInterval(async () => {
        try { await runAutoConfirm(); }
        catch (error) { logger.error('[Jobs] Auto-confirm failed', { error: error.message }); }
    }, TIME_MS.ONE_HOUR);

    setInterval(async () => {
        try { await runPaymentReminders(); }
        catch (error) { logger.error('[Jobs] Payment reminders failed', { error: error.message }); }
    }, TIME_MS.ONE_HOUR);

    setInterval(async () => {
        try { await runSubscriptionCron(); }
        catch (error) { logger.error('[Jobs] Subscription cron failed', { error: error.message }); }
    }, TIME_MS.ONE_HOUR);

    setInterval(async () => {
        try { await runExpiredRefunds(); }
        catch (error) { logger.error('[Jobs] Expired refunds cron failed', { error: error.message }); }
    }, TIME_MS.SIX_HOURS);

    setInterval(async () => {
        try { await runRetryPendingRefunds(); }
        catch (error) { logger.error('[Jobs] Retry pending refunds failed', { error: error.message }); }
    }, TIME_MS.TEN_MIN);

    setTimeout(async () => {
        try { await runSessionReminders(); } catch (e) { logger.error('[Jobs] Startup sessionReminders failed', { error: e.message }); }
        try { await runExpireOffers(); } catch (e) { logger.error('[Jobs] Startup expireOffers failed', { error: e.message }); }
        try { await runAutoConfirm(); } catch (e) { logger.error('[Jobs] Startup autoConfirm failed', { error: e.message }); }
        try { await runPaymentReminders(); } catch (e) { logger.error('[Jobs] Startup paymentReminders failed', { error: e.message }); }
        try { await runSubscriptionCron(); } catch (e) { logger.error('[Jobs] Startup subscriptionCron failed', { error: e.message }); }
        try { await runExpiredRefunds(); } catch (e) { logger.error('[Jobs] Startup expiredRefunds failed', { error: e.message }); }
        try { await runRetryPendingRefunds(); } catch (e) { logger.error('[Jobs] Startup retryPendingRefunds failed', { error: e.message }); }
    }, 10_000);

    logger.info('[Jobs] Scheduled: sessionReminders (1h), expireOffers (15m), autoConfirm (1h), paymentReminders (1h), subscriptionCron (1h), expiredRefunds (6h), retryPendingRefunds (10m)');
}