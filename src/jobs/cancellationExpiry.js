import { logger } from "../config/logger.js";
import { autoApproveStaleCancellations } from "../services/booking.cancellation.service.js";

/**
 * Auto-approve cancellation requests that have been pending for more than 24h
 * with no therapist response. Runs every 1 hour via jobs/index.js.
 */
export const runCancellationExpiry = async () => {
    const { processed, failed } = await autoApproveStaleCancellations();
    if (processed > 0) {
        logger.info(`[CancellationExpiry] Processed ${processed} stale request(s), ${failed} failed`);
    }
};
