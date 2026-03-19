import { prisma } from "../config/prisma.js";
import { releasePayment } from "../services/payment.service.js";
import { logger } from "../config/logger.js";

/**
 * Auto-confirm sessions that were marked complete by therapist but not
 * confirmed by customer within AUTO_CONFIRM_HOURS (default: 72)
 * Runs every 1 hour via jobs/index.js
 *
 * Also recovers stuck sessions: confirmed_by_customer but payment still escrowed
 * (caused by prior releasePayment failures).
 */
export const runAutoConfirm = async () => {
    const hours = parseInt(process.env.AUTO_CONFIRM_HOURS || "72", 10);
    const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000);

    // ── Phase 1: Auto-confirm expired sessions ──────────────────────────
    const sessions = await prisma.session.findMany({
        where: {
            status: "completed_by_therapist",
            completedAt: { lt: cutoff },
        },
        include: {
            booking: true,
        },
    });

    if (sessions.length > 0) {
        logger.info(`[AutoConfirm] Auto-confirming ${sessions.length} session(s)`);

        const results = await Promise.allSettled(
            sessions.map(async (session) => {
                // Atomic: session + booking status update together
                await prisma.$transaction(async (tx) => {
                    await tx.session.update({
                        where: { id: session.id },
                        data: {
                            status: "confirmed_by_customer",
                            confirmedByCustomerAt: new Date(),
                        },
                    });

                    await tx.booking.update({
                        where: { id: session.bookingId },
                        data: { status: "completed" },
                    });
                });

                // Release payment (has its own idempotency via Stripe idempotency key)
                await releasePayment(session.id);

                logger.info(`[AutoConfirm] Auto-confirmed session ${session.id}`);
            })
        );

        const failed = results.filter((r) => r.status === "rejected").length;
        if (failed > 0) {
            logger.error(`[AutoConfirm] ${failed} session(s) failed to auto-confirm`);
        }
    }

    // ── Phase 2: Recover stuck sessions ─────────────────────────────────
    // These are sessions where confirm succeeded but releasePayment failed.
    // Without this recovery, the therapist's money stays in escrow forever.
    const stuckSessions = await prisma.session.findMany({
        where: {
            status: "confirmed_by_customer",
            booking: {
                payment: { status: { in: ["escrowed", "partially_released"] } },
            },
        },
        include: {
            booking: { include: { payment: true } },
        },
    });

    if (stuckSessions.length > 0) {
        logger.warn(`[AutoConfirm] Found ${stuckSessions.length} stuck session(s) with unreleased payments, attempting recovery`);

        const recoveryResults = await Promise.allSettled(
            stuckSessions.map(async (session) => {
                await releasePayment(session.id);
                logger.info(`[AutoConfirm] Recovered stuck payment for session ${session.id}`);
            })
        );

        const recoveryFailed = recoveryResults.filter((r) => r.status === "rejected").length;
        if (recoveryFailed > 0) {
            logger.error(`[AutoConfirm] ${recoveryFailed} stuck session(s) failed recovery — manual intervention required`);
        }
    }
}