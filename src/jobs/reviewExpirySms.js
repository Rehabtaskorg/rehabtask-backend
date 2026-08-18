import { SESSION_STATUS, TIME_MS } from "../utils/constants.js";
import { prisma } from "../config/prisma.js";
import { smsCustWorkReviewExpiring } from "../services/sms.service.js";
import { logger } from "../config/logger.js";

/**
 * Sends a 24-hour warning SMS to customers whose session review window is
 * approaching the auto-release cutoff (AUTO_CONFIRM_HOURS, default 72h).
 *
 * Catch-up design: queries sessions WHERE status = completed_by_therapist
 * AND completedAt <= warn threshold AND reviewExpirySmsSentAt IS NULL.
 * Missed scheduler runs are self-healed — any unwarned session past the
 * threshold is picked up on the next run regardless of how long the gap was.
 *
 * reviewExpirySmsSentAt is stamped regardless of whether the customer was
 * opted in or out, so the job never re-queries the same session twice.
 * Known tradeoff: if the stamp DB write fails after a successful SMS send,
 * the customer may receive a duplicate warning on the next run — this is
 * intentional (duplicate warning << missed warning).
 */
export const runReviewExpirySms = async () => {
    const autoConfirmHours = parseInt(process.env.AUTO_CONFIRM_HOURS || "72", 10);
    const warnAtHours = autoConfirmHours - 24;
    const warnCutoff = new Date(Date.now() - warnAtHours * TIME_MS.ONE_HOUR);

    const sessions = await prisma.session.findMany({
        where: {
            status: SESSION_STATUS.COMPLETED_BY_THERAPIST,
            completedAt: { lte: warnCutoff },
            reviewExpirySmsSentAt: null,
        },
        include: {
            booking: {
                include: {
                    customer: { select: { phone: true, smsOptIn: true } },
                },
            },
        },
    });

    if (sessions.length === 0) return;

    logger.info(`[ReviewExpirySms] Processing ${sessions.length} session(s) for 24h review expiry warning`);

    const now = new Date();
    let sent = 0;
    let skipped = 0;

    for (const session of sessions) {
        try {
            const wasSent = await smsCustWorkReviewExpiring(session.booking.customer, session.booking.id);

            await prisma.session.update({
                where: { id: session.id },
                data: { reviewExpirySmsSentAt: now },
            });

            if (wasSent) {
                sent++;
            } else {
                skipped++;
            }
        } catch (err) {
            logger.error(`[ReviewExpirySms] Failed for session ${session.id}`, { error: err.message });
        }
    }

    logger.info(`[ReviewExpirySms] Done — sent: ${sent}, skipped (no consent/phone): ${skipped}`);
};
