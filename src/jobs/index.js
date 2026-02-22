import { runSessionReminders } from "./sessionReminders.js";
import { logger } from "../config/logger.js";

const ONE_HOUR_MS = 60 * 60 * 1000;

/**
 * Start all scheduled jobs.
 * Call this once from server.js after the app is listening
 * 
 * Uses setInterval since node-cron is not installed
 * Each job is wrapped in try/catch so a failure never crashes the server
 */
export const startScheduledJobs = () => {
    logger.info('[Jobs] Starting scheduled jobs');

    setInterval(async () => {
        try {
            await runSessionReminders();
        } catch (error) {
            logger.error('[Jobs] Session reminders failed', { error: error.message });
        }
    }, ONE_HOUR_MS);

    // Run once at startup (after a short delay to let DB connect)
    setTimeout(async () => {
        try {
            await runSessionReminders();
        } catch (error) {
            logger.error('[Jobs] Initial session reminders run failed', { error: error.message });
        }
    }, 10_000);

    logger.info('[Jobs] Scheduled: sessionReminders (every 1h)');
}