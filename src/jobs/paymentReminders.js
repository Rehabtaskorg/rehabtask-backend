import { prisma } from "../config/prisma.js";
import { sendPaymentReminder } from "../services/email.service.js";
import { logger } from "../config/logger.js";

/**
 * Send payment reminder emails for "accepted" (unpaid) bookings
 * approaching their scheduled date.
 *
 * Two reminder windows:
 *   - 48h before: first reminder (paymentReminderSentAt is null)
 *   - 24h before: second reminder (paymentReminderSentAt was set >20h ago)
 *
 * Uses paymentReminderSentAt to prevent duplicate emails.
 * Skips bookings that are no longer "accepted" (already paid/cancelled).
 */
export const runPaymentReminders = async () => {
    const now = new Date();
    const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const in48h = new Date(now.getTime() + 48 * 60 * 60 * 1000);
    const twentyHoursAgo = new Date(now.getTime() - 20 * 60 * 60 * 1000);

    // Find accepted bookings with scheduledDate within the next 48 hours
    const bookings = await prisma.booking.findMany({
        where: {
            status: "accepted",
            scheduledDate: {
                gt: now,
                lte: in48h,
            },
        },
        include: {
            customer: {
                include: { user: { select: { email: true } } },
            },
            therapist: {
                select: { fullName: true, user: { select: { email: true } } },
            },
        },
    });

    if (bookings.length === 0) {
        logger.info("[PaymentReminders] No unpaid bookings approaching session date");
        return;
    }

    let sent = 0;
    let skipped = 0;

    for (const booking of bookings) {
        const hoursUntil = (new Date(booking.scheduledDate).getTime() - now.getTime()) / (60 * 60 * 1000);

        // Determine if we should send a reminder
        let shouldSend = false;

        if (!booking.paymentReminderSentAt) {
            // First reminder: never sent before
            shouldSend = true;
        } else if (
            hoursUntil <= 24 &&
            new Date(booking.paymentReminderSentAt) < twentyHoursAgo
        ) {
            // Second reminder: within 24h and first was sent >20h ago
            shouldSend = true;
        }

        if (!shouldSend) {
            skipped++;
            continue;
        }

        try {
            await sendPaymentReminder({
                customer: booking.customer,
                therapist: booking.therapist,
                booking,
                hoursUntilSession: Math.round(hoursUntil),
            });

            await prisma.booking.update({
                where: { id: booking.id },
                data: { paymentReminderSentAt: now },
            });

            sent++;
        } catch (err) {
            logger.error("[PaymentReminders] Failed to send reminder", {
                bookingId: booking.id,
                error: err.message,
            });
        }
    }

    logger.info(`[PaymentReminders] Sent: ${sent}, Skipped: ${skipped}`);
};