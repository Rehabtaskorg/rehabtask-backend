import { processExpiredPendingRefunds, REFUND_EXPIRY_DAYS } from "../services/payment.service.js";
import { prisma } from "../config/prisma.js";
import { sendCustomerRefundReminder } from "../services/email.service.js";
import { logger } from "../config/logger.js";

/**
 * Process expired pending_connect refunds + send reminder emails.
 *
 * Runs every 6 hours:
 *   1. Send day-7 reminder to customers who haven't set up Connect
 *   2. Send day-14 reminder (second nudge)
 *   3. Process expired refunds (30+ days) — fallback to card refund
 */
export const runExpiredRefunds = async () => {
    try {
        // ── Step 1: Send reminders ──
        await sendRefundReminders();

        // ── Step 2: Process expired refunds ──
        const result = await processExpiredPendingRefunds();

        if (result.total > 0) {
            logger.info("[ExpiredRefunds] Processed expired pending refunds", {
                processed: result.processed,
                failed: result.failed,
                total: result.total,
            });
        }
    } catch (error) {
        logger.error("[ExpiredRefunds] Job failed", { error: error.message });
    }
};

/**
 * Send reminder emails for pending refunds at day 7 and day 14.
 *
 * Uses connectReminderSentAt to track when the last reminder was sent.
 * - If null and refund is 7+ days old → send first reminder, set timestamp
 * - If timestamp is 7+ days ago and refund is 14+ days old → send second reminder, update timestamp
 * - After day 14, no more reminders — the fallback cron handles expiry at day 30
 */
const sendRefundReminders = async () => {
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

    const pendingRefunds = await prisma.customerRefund.findMany({
        where: {
            status: "pending_connect",
            expiresAt: { gt: now }, // not yet expired
        },
        include: {
            customer: { include: { user: { select: { email: true } } } },
        },
    });

    let sent = 0;

    for (const refund of pendingRefunds) {
        const refundAge = now.getTime() - new Date(refund.createdAt).getTime();
        const daysSinceCreation = Math.floor(refundAge / (1000 * 60 * 60 * 24));
        const daysRemaining = Math.max(0, Math.ceil((new Date(refund.expiresAt) - now) / (1000 * 60 * 60 * 24)));

        try {
            if (!refund.connectReminderSentAt && daysSinceCreation >= 7) {
                // First reminder at day 7
                await sendCustomerRefundReminder({
                    customer: refund.customer,
                    refundAmount: parseFloat(refund.amount),
                    daysRemaining,
                });

                await prisma.customerRefund.update({
                    where: { id: refund.id },
                    data: { connectReminderSentAt: now },
                });

                sent++;
            } else if (refund.connectReminderSentAt && daysSinceCreation >= 14) {
                // Second reminder at day 14 (only if first was sent 7+ days ago)
                const daysSinceLastReminder = Math.floor(
                    (now.getTime() - new Date(refund.connectReminderSentAt).getTime()) / (1000 * 60 * 60 * 24)
                );

                if (daysSinceLastReminder >= 7) {
                    await sendCustomerRefundReminder({
                        customer: refund.customer,
                        refundAmount: parseFloat(refund.amount),
                        daysRemaining,
                    });

                    await prisma.customerRefund.update({
                        where: { id: refund.id },
                        data: { connectReminderSentAt: now },
                    });

                    sent++;
                }
            }
        } catch (err) {
            logger.error("[ExpiredRefunds] Failed to send reminder", {
                refundId: refund.id,
                error: err.message,
            });
        }
    }

    if (sent > 0) {
        logger.info(`[ExpiredRefunds] Sent ${sent} refund reminder(s)`);
    }
};
