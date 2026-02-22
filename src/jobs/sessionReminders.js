import { prisma } from "../config/prisma.js";
import { sendSessionReminder } from "../services/email.service.js";
import { logger } from "../config/logger.js";

/**
 * Send 24-hour session reminders
 * Queries sessions in a 23-25 hour window to safely cover hourly runs
 */
export const runSessionReminders = async () => {
    const now = new Date();
    const windowStart = new Date(now.getTime() + 23 * 60 * 60 * 1000);
    const windowEnd = new Date(now.getTime() + 25 * 60 * 60 * 1000);

    // scheduleDate lives on Booking not Session
    const bookings = await prisma.booking.findMany({
        where: {
            scheduledDate: {
                gte: windowStart,
                lte: windowEnd,
            },
            status: { in: ["confirmed", "pending"] },
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
        bookings.map((booking) =>
            sendSessionReminder({ customer: booking.customer, therapist: booking.therapist, booking })
        )
    );

    const failed = results.filter((r) => r.status === "rejected").length;
    logger.info(`[SessionReminders] Reminders sent: ${bookings.length - failed}, failed: ${failed}`);
}