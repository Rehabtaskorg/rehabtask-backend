import { processExpiredPendingRefunds } from "../services/payment.service.js";
import { logger } from "../config/logger.js";

/**
 * Process expired pending_connect refunds.
 *
 * Customers who haven't set up their Connect payout account within 30 days
 * get an automatic card refund to their original payment method.
 *
 * Runs daily. Each expired refund is processed independently — one failure
 * doesn't block others.
 */
export const runExpiredRefunds = async () => {
    try {
        const result = await processExpiredPendingRefunds();

        if (result.total > 0) {
            logger.info("[ExpiredRefunds] Processed expired pending refunds", {
                processed: result.processed,
                failed: result.failed,
                total: result.total,
            });
        }
    } catch (error) {
        logger.error("[ExpiredRefunds] Job failed", { error: error.message });
    }
};
