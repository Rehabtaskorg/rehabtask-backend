import { prisma } from "../config/prisma.js";
import { releasePayment } from "../services/payment.service.js";
import { logger } from "../config/logger.js";

/**
 * Auto-confirm sessions that were marked complete by therapist but not
 * confirmed by customer within AUTO_CONFIRM_HOURS (default: 72)
 * Runs every 1 hour via jobs/index.js
 */
export const runAutoConfirm = async () => {
    const hours = parseInt(process.env.AUTO_CONFIRM_HOURS || "72", 10);
    const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000);

    const sessions = await prisma.session.findMany({
        where: {
            status: "completed_by_therapist",
            completedAt: { lt: cutoff },
        },
        include: {
            booking: true
        },
    });

    if (sessions.length === 0) return;

    logger.info(`[AutoConfirm] Auto-confirming ${sessions.length} session(s)`);

    const results = await Promise.allSettled(
        sessions.map(async (session) => {
            await prisma.session.update({
                where: { id: session.id },
                data: {
                    status: "confirmed_by_customer",
                    confirmedByCustomerAt: new Date(),
                },
            });

            await prisma.booking.update({
                where: { id: session.bookingId },
                data: { status: "completed" },
            });

            await releasePayment(session.id);

            logger.info(`[AutoConfirm] Auto-confirmed session ${session.id}`);
        })
    );

    const failed = results.filter((r) => r.status === "rejected").length;
    if (failed > 0) {
        logger.error(`[AutoConfirm] ${failed} session(s) failed to auto-confirm`);
    }
}