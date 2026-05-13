import { BOOKING_STATUS } from "../utils/constants.js";
import { prisma } from "../config/prisma.js";
import { getActiveSubscription } from "../services/subscription.service.js";

/**
 * Middleware: Enforce request creation limit based on subscription plan.
 * Applied to POST /requests
 */
export const enforceRequestLimit = async (req, res, next) => {
    try {
        const customerId = req.user.customerProfile?.id;
        if (!customerId) return next();

        const subscription = await getActiveSubscription(customerId);

        // null = unlimited (Premium plan)
        if (subscription.requestLimit === null) return next();

        const activeCount = await prisma.therapyRequest.count({
            where: {
                customerId,
                status: { in: ["created", "offers_received"] },
            },
        });

        if (activeCount >= subscription.requestLimit) {
            return res.status(403).json({
                success: false,
                code: "REQUEST_LIMIT_REACHED",
                message: `You've reached your request limit (${activeCount}/${subscription.requestLimit}). Upgrade your plan to create more.`,
                limit: subscription.requestLimit,
                current: activeCount,
                planType: subscription.planType,
            });
        }

        next();
    } catch (error) {
        next(error);
    }
};

/**
 * Middleware: Enforce therapist booking limit based on subscription plan.
 * Applied to POST /offers/:offerId/accept
 */
export const enforceTherapistLimit = async (req, res, next) => {
    try {
        const customerId = req.user.customerProfile?.id;
        if (!customerId) return next();

        const subscription = await getActiveSubscription(customerId);

        // null = unlimited (Premium plan)
        if (subscription.therapistLimit === null) return next();

        // Get the therapist for this offer
        const offer = await prisma.offer.findUnique({
            where: { id: req.params.offerId },
            select: { therapistId: true },
        });

        if (!offer) return next(); // Let the controller handle "offer not found"

        // Count unique therapists with active bookings
        const activeTherapists = await prisma.booking.groupBy({
            by: ["therapistId"],
            where: {
                customerId,
                status: { in: [BOOKING_STATUS.ACCEPTED, BOOKING_STATUS.CONFIRMED, BOOKING_STATUS.IN_PROGRESS] },
            },
        });

        const activeTherapistIds = activeTherapists.map((b) => b.therapistId);

        // If this therapist already has an active booking, allow (not a new slot)
        if (activeTherapistIds.includes(offer.therapistId)) return next();

        if (activeTherapistIds.length >= subscription.therapistLimit) {
            return res.status(403).json({
                success: false,
                code: "THERAPIST_LIMIT_REACHED",
                message: `You've reached your therapist limit (${activeTherapistIds.length}/${subscription.therapistLimit}). Upgrade your plan to connect with more therapists.`,
                limit: subscription.therapistLimit,
                current: activeTherapistIds.length,
                planType: subscription.planType,
            });
        }

        next();
    } catch (error) {
        next(error);
    }
};