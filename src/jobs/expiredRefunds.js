import { REPORT_MS_PER_DAY } from "../utils/constants.js";
import { prisma } from "../config/prisma.js";
import { sendCustomerRefundReminder } from "../services/email.service.js";
import { logger } from "../config/logger.js";

/**
 * Send reminder emails for pending_connect refunds.
 * Runs every 6 hours. No card refund fallback — money stays pending
 * indefinitely until the customer sets up their Connect account.
 */
export const runExpiredRefunds = async () => {
    try {
        await sendRefundReminders();
    } catch (error) {
        logger.error("[ExpiredRefunds] Job failed", { error: error.message });
    }
};

const sendRefundReminders = async () => {
    const now = new Date();

    const pendingRefunds = await prisma.customerRefund.findMany({
        where: { status: "pending_connect" },
        include: {
            customer: { include: { user: { select: { email: true } } } },
        },
    });

    let sent = 0;

    for (const refund of pendingRefunds) {
        const daysSinceCreation = Math.floor(
            (now.getTime() - new Date(refund.createdAt).getTime()) / REPORT_MS_PER_DAY
        );

        try {
            if (!refund.connectReminderSentAt && daysSinceCreation >= 7) {
                await sendCustomerRefundReminder({
                    customer: refund.customer,
                    refundAmount: parseFloat(refund.amount),
                });

                await prisma.customerRefund.update({
                    where: { id: refund.id },
                    data: { connectReminderSentAt: now },
                });

                sent++;
            } else if (refund.connectReminderSentAt && daysSinceCreation >= 14) {
                const daysSinceLastReminder = Math.floor(
                    (now.getTime() - new Date(refund.connectReminderSentAt).getTime()) / REPORT_MS_PER_DAY
                );

                if (daysSinceLastReminder >= 7) {
                    await sendCustomerRefundReminder({
                        customer: refund.customer,
                        refundAmount: parseFloat(refund.amount),
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
