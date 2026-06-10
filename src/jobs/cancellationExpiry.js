import { logger } from "../config/logger.js";
import { autoApproveStaleCancellations, autoDeclineStaleTherapistCancellations } from "../services/booking.cancellationExpiry.service.js";

/**
 * Resolve cancellation requests that have been pending for more than 24h with no response.
 * Customer-initiated requests auto-approve (refund proceeds). Therapist-initiated requests
 * auto-decline (booking restored, no money moves). Runs every 1 hour via jobs/index.js.
 */
export const runCancellationExpiry = async () => {
    const approved = await autoApproveStaleCancellations();
    if (approved.processed > 0) {
        logger.info(`[CancellationExpiry] Auto-approved ${approved.processed} stale customer request(s), ${approved.failed} failed`);
    }

    const declined = await autoDeclineStaleTherapistCancellations();
    if (declined.processed > 0) {
        logger.info(`[CancellationExpiry] Auto-declined ${declined.processed} stale therapist request(s), ${declined.failed} failed`);
    }
};
