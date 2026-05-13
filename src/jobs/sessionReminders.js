import { BOOKING_STATUS, TIME_MS } from "../utils/constants.js";
import { prisma } from "../config/prisma.js";
import { sendSessionReminder } from "../services/email.service.js";
import { logger } from "../config/logger.js";

/**
 * Send 24-hour session reminders
 * Queries sessions in a 23-25 hour window to safely cover hourly runs
 */
export const runSessionReminders = async () => {
    const now = new Date();
    const windowStart = new Date(now.getTime() + TIME_MS.TWENTY_THREE_HOURS);
    const windowEnd = new Date(now.getTime() + TIME_MS.TWENTY_FIVE_HOURS);

    // scheduleDate lives on Booking not Session
    const bookings = await prisma.booking.findMany({
        where: {
            scheduledDate: {
                gte: windowStart,
                lte: windowEnd,
            },
            status: { in: ["confirmed", "pending", "accepted"] },
        },
        include: {
            customer: {
                include: { user: { select: { id: true, email: true } } }
            },
            therapist: {
                include: { user: { select: { id: true, email: true } } }
            },
        },
    });

    logger.info(`[SessionReminders] Found ${bookings.length} upcoming sessions`);

    const results = await Promise.allSettled(
        bookings.flatMap((booking) => [
            sendSessionReminder({ recipient: booking.customer, booking, role: USER_ROLES.CUSTOMER }),
            sendSessionReminder({ recipient: booking.therapist, booking, role: USER_ROLES.THERAPIST }),
        ])
    );

    const failed = results.filter((r) => r.status === "rejected").length;
    const sent = results.length - failed;
    logger.info(`[SessionReminders] Reminders sent: ${sent}, failed: ${failed}`);
}