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
                // Atomic: confirm this session, check if ALL sessions done
                const allConfirmed = await prisma.$transaction(async (tx) => {
                    await tx.session.update({
                        where: { id: session.id },
                        data: {
                            status: "confirmed_by_customer",
                            confirmedByCustomerAt: new Date(),
                        },
                    });

                    // Check if ALL sessions for this booking are now confirmed
                    const allSessions = await tx.session.findMany({
                        where: { bookingId: session.bookingId },
                    });
                    const confirmedCount = allSessions.filter(s =>
                        s.id === session.id || s.status === "confirmed_by_customer"
                    ).length;

                    if (confirmedCount === allSessions.length) {
                        await tx.booking.update({
                            where: { id: session.bookingId },
                            data: { status: "completed" },
                        });
                        return true;
                    }
                    return false;
                });

                // Only release payment when ALL sessions are confirmed
                if (allConfirmed) {
                    await releasePayment(session.id);
                    logger.info(`[AutoConfirm] All sessions confirmed — payment released for booking ${session.bookingId}`);
                } else {
                    logger.info(`[AutoConfirm] Auto-confirmed session ${session.id}, waiting for remaining sessions`);
                }
            })
        );

        const failed = results.filter((r) => r.status === "rejected").length;
        if (failed > 0) {
            logger.error(`[AutoConfirm] ${failed} session(s) failed to auto-confirm`);
        }
    }

    // ── Phase 2: Recover stuck bookings ─────────────────────────────────
    // Find bookings where ALL sessions are confirmed but payment was never
    // released (caused by a prior releasePayment failure). Without this
    // recovery the therapist's money stays in escrow forever.
    // CRITICAL: Only release when EVERY session in the booking is confirmed.
    const stuckBookings = await prisma.booking.findMany({
        where: {
            status: "completed",
            payment: { status: { in: ["escrowed", "partially_released"] } },
        },
        include: {
            payment: true,
            sessions: { orderBy: { sessionNumber: "asc" } },
        },
    });

    if (stuckBookings.length > 0) {
        logger.warn(`[AutoConfirm] Found ${stuckBookings.length} stuck booking(s) with unreleased payments, attempting recovery`);

        const recoveryResults = await Promise.allSettled(
            stuckBookings.map(async (booking) => {
                const allConfirmed = booking.sessions.every(s => s.status === "confirmed_by_customer");
                if (!allConfirmed) {
                    logger.warn(`[AutoConfirm] Booking ${booking.id} marked completed but has unconfirmed sessions — skipping release`);
                    return;
                }
                const lastSession = booking.sessions[booking.sessions.length - 1];
                await releasePayment(lastSession.id);
                logger.info(`[AutoConfirm] Recovered stuck payment for booking ${booking.id}`);
            })
        );

        const recoveryFailed = recoveryResults.filter((r) => r.status === "rejected").length;
        if (recoveryFailed > 0) {
            logger.error(`[AutoConfirm] ${recoveryFailed} stuck booking(s) failed recovery — manual intervention required`);
        }
    }
}