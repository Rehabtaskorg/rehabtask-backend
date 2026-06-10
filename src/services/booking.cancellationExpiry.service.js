import { BOOKING_STATUS, USER_ROLES } from "../utils/constants.js";
import { prisma } from "../config/prisma.js";
import { logger } from "../config/logger.js";
import { logAction } from "./audit.service.js";
import { executeCancellationApproval } from "./booking.cancellation.service.js";
import { sendCancellationAutoDeclinedToTherapist } from "./email.service.js";

/**
 * Cron job: auto-approve customer-initiated cancellation requests older than 24 hours.
 * Protects the customer from therapist non-response — the refund proceeds automatically.
 * Called by the cancellation expiry cron on an hourly schedule.
 */
export const autoApproveStaleCancellations = async () => {
    const cutoff = new Date(Date.now() - 24 * 3_600_000);

    const stale = await prisma.booking.findMany({
        where: {
            status: BOOKING_STATUS.CANCELLATION_REQUESTED,
            cancellationRequestedBy: USER_ROLES.CUSTOMER,
            cancellationRequestedAt: { lt: cutoff },
        },
        select: { id: true },
    });

    if (stale.length === 0) return { processed: 0 };

    logger.info(`[CancellationExpiryService] Auto-approving ${stale.length} stale customer-initiated cancellation request(s)`);

    const results = await Promise.allSettled(
        stale.map(({ id }) => executeCancellationApproval(id, { isAuto: true, actorId: "system" }))
    );

    const failed = results.filter(r => r.status === "rejected");
    if (failed.length > 0) {
        logger.error("[CancellationExpiryService] Some auto-approvals failed", { failed: failed.map(f => f.reason?.message) });
    }

    return { processed: stale.length, failed: failed.length };
};

/**
 * Cron job: auto-decline therapist-initiated cancellation requests older than 24 hours.
 * Protects the customer from an involuntary cancellation/refund they never agreed to —
 * the booking is restored to its pre-cancellation status and no money moves.
 * Called by the cancellation expiry cron on an hourly schedule.
 */
export const autoDeclineStaleTherapistCancellations = async () => {
    const cutoff = new Date(Date.now() - 24 * 3_600_000);

    const stale = await prisma.booking.findMany({
        where: {
            status: BOOKING_STATUS.CANCELLATION_REQUESTED,
            cancellationRequestedBy: USER_ROLES.THERAPIST,
            cancellationRequestedAt: { lt: cutoff },
        },
        include: {
            therapist: { select: { userId: true, fullName: true, user: { select: { email: true } } } },
            customer: { select: { userId: true, fullName: true, user: { select: { email: true } } } },
        },
    });

    if (stale.length === 0) return { processed: 0 };

    logger.info(`[CancellationExpiryService] Auto-declining ${stale.length} stale therapist-initiated cancellation request(s)`);

    const results = await Promise.allSettled(stale.map(async (booking) => {
        const restoredStatus = booking.preCancellationStatus ?? BOOKING_STATUS.CONFIRMED;

        await prisma.booking.update({
            where: { id: booking.id },
            data: {
                status: restoredStatus,
                cancellationReason: null,
                cancellationRequestedAt: null,
                cancellationRequestedBy: null,
                preCancellationStatus: null,
            },
        });

        sendCancellationAutoDeclinedToTherapist({ customer: booking.customer, therapist: booking.therapist, booking }).catch(logger.error);

        logAction({
            actorId: "system",
            action: "booking.cancellation_auto_declined",
            entityType: "booking",
            entityId: booking.id,
            changes: { restoredStatus },
        });
    }));

    const failed = results.filter(r => r.status === "rejected");
    if (failed.length > 0) {
        logger.error("[CancellationExpiryService] Some auto-declines failed", { failed: failed.map(f => f.reason?.message) });
    }

    return { processed: stale.length, failed: failed.length };
};
