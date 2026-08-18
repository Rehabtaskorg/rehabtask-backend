import { prisma } from "../config/prisma.js";
import { getActiveSubscription } from "../services/subscription.service.js";

/**
 * Middleware: Enforce visit limit based on subscription plan.
 * Applied to POST /offers/:offerId/accept
 * Reads sessionsUsed directly from the subscription record — no aggregation query.
 */
export const enforceVisitLimit = async (req, res, next) => {
    try {
        const customerId = req.user.customerProfile?.id;
        if (!customerId) return next();

        const subscription = await getActiveSubscription(customerId);

        if (subscription.visitLimit >= 999999) return next();

        if (subscription.sessionsUsed >= subscription.visitLimit) {
            return res.status(403).json({
                success: false,
                code: "VISIT_LIMIT_REACHED",
                message: `You've reached your visit limit (${subscription.sessionsUsed}/${subscription.visitLimit}) for this billing period. Upgrade your plan to continue.`,
                limit: subscription.visitLimit,
                current: subscription.sessionsUsed,
                planType: subscription.planType,
            });
        }

        next();
    } catch (error) {
        next(error);
    }
};

/**
 * Middleware: Enforce job posting limit based on subscription plan.
 * Applied to POST /requests
 * Counts active TherapyRequests (created or offers_received).
 */
export const enforceJobPostingLimit = async (req, res, next) => {
    try {
        const customerId = req.user.customerProfile?.id;
        if (!customerId) return next();

        const subscription = await getActiveSubscription(customerId);

        if (subscription.jobPostingLimit >= 999999) return next();

        const activeCount = await prisma.therapyRequest.count({
            where: {
                customerId,
                status: { in: ["created", "offers_received"] },
            },
        });

        if (activeCount >= subscription.jobPostingLimit) {
            return res.status(403).json({
                success: false,
                code: "JOB_POSTING_LIMIT_REACHED",
                message: `You've reached your job posting limit (${activeCount}/${subscription.jobPostingLimit}). Upgrade your plan to post more.`,
                limit: subscription.jobPostingLimit,
                current: activeCount,
                planType: subscription.planType,
            });
        }

        next();
    } catch (error) {
        next(error);
    }
};