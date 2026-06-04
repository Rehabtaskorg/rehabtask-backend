import { logger } from "../config/logger.js";
import { autoApproveStaleSessionCancellations } from "../services/session.cancellation.service.js";

/**
 * Auto-approve session cancellation requests pending for more than 24h.
 * Runs every 1 hour via jobs/index.js.
 */
export const runSessionCancellationExpiry = async () => {
    const { processed, failed } = await autoApproveStaleSessionCancellations();
    if (processed > 0) {
        logger.info(`[SessionCancellationExpiry] Processed ${processed} stale request(s), ${failed} failed`);
    }
};
