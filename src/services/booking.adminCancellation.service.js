import { BOOKING_STATUS, USER_ROLES } from "../utils/constants.js";
import { prisma } from "../config/prisma.js";
import { NotFoundError, ConflictError } from "../utils/errors.js";
import { logger } from "../config/logger.js";
import { logAction } from "./audit.service.js";
import { executeCancellationApproval } from "./booking.cancellation.service.js";
import {
    sendCancellationRejectedToCustomer,
    sendCancellationRejectedToTherapist,
} from "./email.service.js";

/**
 * Admin override — approve or reject a pending cancellation, bypassing the 24h window.
 *
 * @param {string} bookingId
 * @param {"approve" | "reject"} action
 * @param {string} adminId
 * @param {string} [rejectionReason] - required when action is "reject"
 */
export const adminOverrideCancellation = async (bookingId, action, adminId, rejectionReason) => {
    const booking = await prisma.booking.findUnique({
        where: { id: bookingId },
        include: {
            therapist: { select: { userId: true, fullName: true, user: { select: { email: true } } } },
            customer: { select: { userId: true, fullName: true, user: { select: { email: true } } } },
        },
    });
    if (!booking) throw new NotFoundError("Booking not found");
    if (booking.status !== BOOKING_STATUS.CANCELLATION_REQUESTED) throw new ConflictError("No pending cancellation request on this booking");

    if (action === "approve") {
        return executeCancellationApproval(bookingId, { actorId: adminId });
    }

    if (action === "reject") {
        if (!rejectionReason?.trim()) throw new ConflictError("Rejection reason is required");
        const restoredStatus = booking.preCancellationStatus ?? BOOKING_STATUS.CONFIRMED;

        await prisma.booking.update({
            where: { id: bookingId },
            data: { status: restoredStatus, cancellationReason: null, cancellationRequestedAt: null, cancellationRequestedBy: null, preCancellationStatus: null },
        });

        if (booking.cancellationRequestedBy === USER_ROLES.THERAPIST) {
            sendCancellationRejectedToTherapist({ customer: booking.customer, therapist: booking.therapist, booking, rejectionReason }).catch(logger.error);
        } else {
            sendCancellationRejectedToCustomer({ customer: booking.customer, therapist: booking.therapist, booking, rejectionReason }).catch(logger.error);
        }
        logAction({ actorId: adminId, action: "booking.cancellation_rejected_by_admin", entityType: "booking", entityId: bookingId, changes: { rejectionReason, restoredStatus } });

        return { status: restoredStatus, rejectionReason };
    }

    throw new ConflictError("Invalid action. Must be 'approve' or 'reject'");
};
