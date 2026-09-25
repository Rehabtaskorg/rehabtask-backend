import { SESSION_STATUS, TIME_MS } from "../utils/constants.js";
import { prisma } from "../config/prisma.js";
import { smsTherRevisionExpiringSoon, smsCustRevisionExpiringSoon } from "../services/sms.service.js";
import { logger } from "../config/logger.js";

/**
 * Sends 24h warning SMS to both therapist and customer when a revision deadline
 * is approaching. Fires when revisionDueBy is between now and now+24h.
 *
 * Same idempotency stamp pattern as reviewExpirySms: stamps revisionExpirySmsSentAt
 * regardless of opt-in status so the job never re-queries the same session twice.
 * Stamp is in its own try/catch so a Twilio failure cannot cause perpetual retry.
 */
export const runRevisionExpirySms = async () => {
    const now = new Date();
    const warnCutoff = new Date(now.getTime() + TIME_MS.TWENTY_FOUR_HOURS);

    const sessions = await prisma.session.findMany({
        where: {
            status: SESSION_STATUS.IN_REVISION,
            revisionDueBy: { gt: now, lte: warnCutoff },
            revisionExpirySmsSentAt: null,
        },
        include: {
            booking: {
                include: {
                    customer: { select: { phone: true, smsOptIn: true } },
                    therapist: { select: { phone: true, smsOptIn: true } },
                },
            },
        },
    });

    if (sessions.length === 0) return;

    logger.info(`[RevisionExpirySms] Processing ${sessions.length} session(s) for 24h revision deadline warning`);

    let sent = 0;
    let skipped = 0;

    for (const session of sessions) {
        const [therResult, custResult] = await Promise.allSettled([
            smsTherRevisionExpiringSoon(session.booking.therapist, session.bookingId),
            smsCustRevisionExpiringSoon(session.booking.customer, session.bookingId),
        ]);
        if (therResult.status === "rejected") {
            logger.error(`[RevisionExpirySms] Therapist send failed for session ${session.id}`, { error: therResult.reason?.message });
        }
        if (custResult.status === "rejected") {
            logger.error(`[RevisionExpirySms] Customer send failed for session ${session.id}`, { error: custResult.reason?.message });
        }
        const therSent = therResult.status === "fulfilled" && therResult.value === true;
        const custSent = custResult.status === "fulfilled" && custResult.value === true;
        if (therSent || custSent) sent++;
        else skipped++;

        try {
            await prisma.session.update({
                where: { id: session.id },
                data: { revisionExpirySmsSentAt: now },
            });
        } catch (err) {
            logger.error(`[RevisionExpirySms] Stamp failed for session ${session.id}`, { error: err.message });
        }
    }

    logger.info(`[RevisionExpirySms] Done — sessions processed: ${sent + skipped}, sent: ${sent}, skipped (no consent/phone): ${skipped}`);
};