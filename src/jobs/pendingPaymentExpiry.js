import { BOOKING_STATUS, OFFER_STATUS, REQUEST_STATUS, REOPENABLE_REQUEST_STATUSES, TIME_MS } from "../utils/constants.js";
import { prisma } from "../config/prisma.js";
import { stripe } from "../config/stripe.js";
import { logSystemEvent } from "../services/audit.service.js";
import { logger } from "../config/logger.js";

const UNCANCELLABLE_INTENT_STATUSES = ["requires_action", "processing", "succeeded"];

/**
 * Expire abandoned pending_payment bookings after a 1 hour TTL.
 */
export const runPendingPaymentExpiry = async () => {
    const expiryCutoff = new Date(Date.now() - TIME_MS.ONE_HOUR);

    const bookings = await prisma.booking.findMany({
        where: {
            status: BOOKING_STATUS.PENDING_PAYMENT,
            createdAt: { lt: expiryCutoff },
        },
        include: {
            payment: true,
            offer: { select: { id: true, requestId: true, expiresAt: true } },
        },
    });

    if (bookings.length === 0) return;

    logger.info(`[PendingPaymentExpiry] Processing ${bookings.length} expired pending_payment booking(s)`);

    let cancelled = 0;
    let skipped = 0;
    let failed = 0;

    for (const booking of bookings) {
        try {
            const { payment } = booking;

            if (payment?.stripePaymentIntentId) {
                const intent = await stripe.paymentIntents.retrieve(payment.stripePaymentIntentId);

                if (UNCANCELLABLE_INTENT_STATUSES.includes(intent.status)) {
                    logger.info(`[PendingPaymentExpiry] Skipping booking ${booking.id} — intent is ${intent.status}`);
                    skipped++;
                    continue;
                }

                if (intent.status !== "canceled") {
                    await stripe.paymentIntents.cancel(payment.stripePaymentIntentId, {
                        cancellation_reason: "abandoned",
                    }).catch((err) => {
                        logger.warn("[PendingPaymentExpiry] PaymentIntent cancel failed", { bookingId: booking.id, intentId: payment.stripePaymentIntentId, error: err.message });
                    });
                }
            }

            await prisma.$transaction(async (tx) => {
                const claimed = await tx.booking.updateMany({
                    where: { id: booking.id, status: BOOKING_STATUS.PENDING_PAYMENT },
                    data: { status: BOOKING_STATUS.CANCELLED, cancellationReason: "Payment not completed within 1 hour" },
                });
                if (claimed.count === 0) return;

                if (payment) {
                    await tx.payment.update({ where: { id: payment.id }, data: { status: "failed" } });
                }

                if (booking.offer) {
                    await tx.therapyRequest.updateMany({
                        where: { id: booking.offer.requestId, status: { in: REOPENABLE_REQUEST_STATUSES } },
                        data: { status: REQUEST_STATUS.OFFERS_RECEIVED },
                    });

                    const offerStillValid = new Date(booking.offer.expiresAt) > new Date();
                    await tx.offer.updateMany({
                        where: { id: booking.offer.id, status: OFFER_STATUS.ACCEPTED },
                        data: { status: offerStillValid ? OFFER_STATUS.PENDING : "expired" },
                    });
                }
            }, { timeout: 15000 });

            logSystemEvent({
                action: "booking.pending_payment_expired",
                entityType: "booking",
                entityId: booking.id,
                changes: {
                    paymentId: payment?.id ?? null,
                    stripePaymentIntentId: payment?.stripePaymentIntentId ?? null,
                    reopenedRequestId: booking.offer?.requestId ?? null,
                },
            });

            cancelled++;
        } catch (err) {
            logger.error(`[PendingPaymentExpiry] Failed to expire booking ${booking.id}`, { error: err.message });
            failed++;
        }
    }

    logger.info(`[PendingPaymentExpiry] Done — cancelled: ${cancelled}, skipped (payment in progress): ${skipped}, failed: ${failed}`);
};