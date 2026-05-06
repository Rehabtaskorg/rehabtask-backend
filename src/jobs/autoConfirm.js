import { prisma } from "../config/prisma.js";
import { releaseSessionPayout } from "../services/payment.service.js";
import { logger } from "../config/logger.js";

/**
 * Auto-confirm sessions that were marked complete by therapist but not
 * confirmed by customer within AUTO_CONFIRM_HOURS (default: 72)
 * Runs every 1 hour via jobs/index.js
 *
 * Also recovers stuck sessions: confirmed_by_customer but payout never created
 * (caused by prior releaseSessionPayout failures).
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
            booking: {
                include: {
                    therapist: true,
                    payment: true,
                },
            },
        },
    });

    if (sessions.length > 0) {
        logger.info(`[AutoConfirm] Auto-confirming ${sessions.length} session(s)`);

        const results = await Promise.allSettled(
            sessions.map(async (session) => {
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
                }, { timeout: 10000 });

                // Per-session payout — release for this session immediately
                const payment = session.booking.payment;
                if (payment && ["escrowed", "partially_released"].includes(payment.status)) {
                    try {
                        // Refresh payment to get latest releasedAmount
                        const currentPayment = await prisma.payment.findUnique({ where: { id: payment.id } });
                        await releaseSessionPayout({
                            session: { ...session, status: "confirmed_by_customer" },
                            payment: currentPayment,
                            booking: session.booking,
                            isLast: allConfirmed,
                        });
                        logger.info(`[AutoConfirm] Per-session payout released for session ${session.id}`, {
                            bookingId: session.bookingId,
                            isLast: allConfirmed,
                        });
                    } catch (payoutErr) {
                        logger.error(`[AutoConfirm] Per-session payout failed for session ${session.id}`, {
                            bookingId: session.bookingId,
                            error: payoutErr.message,
                        });
                    }
                }
            })
        );

        const failed = results.filter((r) => r.status === "rejected").length;
        if (failed > 0) {
            logger.error(`[AutoConfirm] ${failed} session(s) failed to auto-confirm`);
        }
    }

    // Find confirmed sessions that never got a SessionPayout (caused by a
    // prior releaseSessionPayout failure). Without this recovery the
    // therapist's money stays in escrow forever.
    const stuckSessions = await prisma.session.findMany({
        where: {
            status: "confirmed_by_customer",
            payout: null, // no SessionPayout record exists
            booking: {
                payment: { status: { in: ["escrowed", "partially_released"] } },
            },
        },
        include: {
            booking: {
                include: {
                    therapist: true,
                    payment: true,
                    sessions: { orderBy: { sessionNumber: "asc" } },
                },
            },
        },
    });

    if (stuckSessions.length > 0) {
        logger.warn(`[AutoConfirm] Found ${stuckSessions.length} stuck session(s) without payouts, attempting recovery`);

        const recoveryResults = await Promise.allSettled(
            stuckSessions.map(async (session) => {
                const allSessions = session.booking.sessions;
                const allConfirmed = allSessions.every(s => s.status === "confirmed_by_customer");
                // This is the last payout if all sessions are confirmed and this
                // is the last confirmed session by sessionNumber
                const confirmedSorted = allSessions
                    .filter(s => s.status === "confirmed_by_customer")
                    .sort((a, b) => (a.sessionNumber ?? 0) - (b.sessionNumber ?? 0));
                const isLast = allConfirmed && confirmedSorted[confirmedSorted.length - 1]?.id === session.id;

                const currentPayment = await prisma.payment.findUnique({ where: { id: session.booking.payment.id } });
                await releaseSessionPayout({
                    session,
                    payment: currentPayment,
                    booking: session.booking,
                    isLast,
                });
                logger.info(`[AutoConfirm] Recovered stuck payout for session ${session.id}`, {
                    bookingId: session.bookingId,
                    isLast,
                });
            })
        );

        const recoveryFailed = recoveryResults.filter((r) => r.status === "rejected").length;
        if (recoveryFailed > 0) {
            logger.error(`[AutoConfirm] ${recoveryFailed} stuck session(s) failed recovery — manual intervention required`);
        }
    }
}