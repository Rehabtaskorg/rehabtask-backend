import { runTrialExpiry, runGracePeriodExpiry } from "../services/subscription.service.js";
import { logger } from "../config/logger.js";

/**
 * Run all subscription-related cron tasks.
 * Called by the job scheduler every hour.
 */
export const runSubscriptionCron = async () => {
    try {
        await runTrialExpiry();
    } catch (error) {
        logger.error("[Jobs] Trial expiry failed", { error: error.message });
    }

    try {
        await runGracePeriodExpiry();
    } catch (error) {
        logger.error("[Jobs] Grace period expiry failed", { error: error.message });
    }
};