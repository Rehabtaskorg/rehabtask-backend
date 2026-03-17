import { prisma } from "../config/prisma.js";
import { logger } from "../config/logger.js";

/**
 * Expire pending offers whose expiresAt has passed
 * Also expire change_requested offers that have passed their expiry window.
 * Runs every 15 minutes via jobs/index.js
 */
export const runExpireOffers = async () => {
    const now = new Date();

    const result = await prisma.offer.updateMany({
        where: {
            status: { in: ["pending", "change_requested"] },
            expiresAt: { lt: now },
        },
        data: { status: "expired" },
    });

    if (result.count > 0) {
        logger.info(`[ExpireOffers] Expired ${result.count} offer(s)`);
    }

    return result;
}
