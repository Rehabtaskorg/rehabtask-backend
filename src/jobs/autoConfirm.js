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

    console.log(`[DEBUG:AUTO_CONFIRM] Job running | Cutoff: ${cutoff.toISOString()} (${hours}h ago)`);

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

    console.log(`[DEBUG:AUTO_CONFIRM] Phase 1: Found ${sessions.length} session(s) past ${hours}h cutoff`);

    if (sessions.length > 0) {
        sessions.forEach(s => {
            console.log(`[DEBUG:AUTO_CONFIRM]   → Session ${s.id} | Booking ${s.bookingId} | completedAt: ${s.completedAt}`);
        });

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

    console.log(`[DEBUG:AUTO_CONFIRM] Phase 2: Found ${stuckBookings.length} stuck booking(s) (completed but payment unreleased)`);

    if (stuckBookings.length > 0) {
        stuckBookings.forEach(b => {
            console.log(`[DEBUG:AUTO_CONFIRM]   → Booking ${b.id} | Payment: ${b.payment?.status} | Sessions: ${b.sessions.map(s => `${s.sessionNumber}:${s.status}`).join(", ")}`);
        });

        const recoveryResults = await Promise.allSettled(
            stuckBookings.map(async (booking) => {
                const allConfirmed = booking.sessions.every(s => s.status === "confirmed_by_customer");
                if (!allConfirmed) {
                    console.log(`[DEBUG:AUTO_CONFIRM] ❌ Booking ${booking.id} has unconfirmed sessions — SKIPPING release`);
                    return;
                }
                console.log(`[DEBUG:AUTO_CONFIRM] ✅ Booking ${booking.id} all sessions confirmed — attempting recovery release`);
                const lastSession = booking.sessions[booking.sessions.length - 1];
                await releasePayment(lastSession.id);
                console.log(`[DEBUG:AUTO_CONFIRM] ✅ Recovered stuck payment for booking ${booking.id}`);
            })
        );

        const recoveryFailed = recoveryResults.filter((r) => r.status === "rejected").length;
        if (recoveryFailed > 0) {
            logger.error(`[AutoConfirm] ${recoveryFailed} stuck booking(s) failed recovery — manual intervention required`);
        }
    }
}