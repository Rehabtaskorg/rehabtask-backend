import { REFUND_STATUS } from "../utils/constants.js";
import { prisma } from "../config/prisma.js";
import { createPerSessionRefund } from "../services/payment.service.js";
import { logger } from "../config/logger.js";

const MAX_ATTEMPTS = 5;

/**
 * Retry attempted-visit refunds that failed after the therapist payout succeeded.
 * Rows are written by session.service.js when createPerSessionRefund throws.
 * Runs every 10 minutes. After MAX_ATTEMPTS failures the row is marked 'failed'
 * and requires manual admin intervention.
 */
export const runRetryPendingRefunds = async () => {
    const pending = await prisma.pendingRefundRetry.findMany({
        where: { status: REFUND_STATUS.PENDING },
        orderBy: { createdAt: "asc" },
    });

    if (pending.length === 0) return;

    logger.info(`[RetryPendingRefunds] Processing ${pending.length} pending refund(s)`);

    for (const row of pending) {
        // Increment attempt counter immediately so parallel runs can't double-process
        await prisma.pendingRefundRetry.update({
            where: { id: row.id },
            data: { attempts: { increment: 1 }, lastAttemptAt: new Date() },
        });

        try {
            // Re-fetch live references needed by createPerSessionRefund
            const [session, payment, customer, booking] = await Promise.all([
                prisma.session.findUnique({ where: { id: row.sessionId }, select: { id: true, bookingId: true } }),
                prisma.payment.findUnique({ where: { id: row.paymentId }, select: { id: true, stripePaymentIntentId: true } }),
                prisma.customerProfile.findUnique({ where: { id: row.customerId }, select: { id: true, stripeAccountId: true, stripeOnboardingComplete: true } }),
                prisma.booking.findUnique({
                    where: { id: row.bookingId },
                    select: {
                        id: true,
                        rate: true,
                        therapist: { select: { id: true, userId: true, planTier: true } },
                    },
                }),
            ]);

            if (!session || !payment || !customer || !booking) {
                throw new Error("One or more required records no longer exist");
            }

            await createPerSessionRefund({
                session: { id: session.id, bookingId: session.bookingId },
                payment: { id: payment.id, stripePaymentIntentId: payment.stripePaymentIntentId },
                customer,
                booking: { id: booking.id, rate: booking.rate, therapist: booking.therapist },
                reason: row.reason,
                amount: parseFloat(row.amount),
            });

            await prisma.pendingRefundRetry.update({
                where: { id: row.id },
                data: { status: "resolved", resolvedAt: new Date() },
            });

            logger.info("[RetryPendingRefunds] Refund resolved", { retryId: row.id, sessionId: row.sessionId });
        } catch (err) {
            const currentRow = await prisma.pendingRefundRetry.findUnique({
                where: { id: row.id },
                select: { attempts: true },
            });

            const newStatus = currentRow && currentRow.attempts >= MAX_ATTEMPTS ? REFUND_STATUS.FAILED : REFUND_STATUS.PENDING;

            await prisma.pendingRefundRetry.update({
                where: { id: row.id },
                data: { errorLog: err.message, status: newStatus },
            });

            if (newStatus === REFUND_STATUS.FAILED) {
                logger.error("[RetryPendingRefunds] CRITICAL: Refund permanently failed after max attempts — manual action required", {
                    retryId: row.id,
                    sessionId: row.sessionId,
                    bookingId: row.bookingId,
                    amount: row.amount,
                    error: err.message,
                });
            } else {
                logger.warn("[RetryPendingRefunds] Refund retry failed, will retry again", {
                    retryId: row.id,
                    attempts: currentRow?.attempts,
                    error: err.message,
                });
            }
        }
    }
};
