import { SESSION_STATUS } from "./constants.js";

/**
 * Resolve how many subscription visit credits to restore when a booking is cancelled.
 * @param {{ sessions?: Array<{ status: string }> }} booking - Booking row with its `sessions` relation loaded
 * @returns {number} Count of credits to decrement from `subscription.sessionsUsed`
 */
export const resolveCreditsToRestore = (booking) =>
    booking?.sessions?.filter((session) => session.status !== SESSION_STATUS.CANCELLED).length ?? 0;