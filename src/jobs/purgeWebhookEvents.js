import { prisma } from "../config/prisma.js";
import { logger } from "../config/logger.js";
import { TIME_MS } from "../utils/constants.js";

/**
 * Deletes ProcessedWebhookEvent records older than 90 days.
 * Stripe's retry window is 72 hours — 90 days gives 30× margin plus audit coverage.
 */
export const runPurgeWebhookEvents = async () => {
    const cutoff = new Date(Date.now() - TIME_MS.NINETY_DAYS);
    const { count } = await prisma.processedWebhookEvent.deleteMany({
        where: { processedAt: { lt: cutoff } },
    });
    if (count > 0) logger.info(`[Jobs] Purged ${count} processed webhook events older than 90 days`);
};
