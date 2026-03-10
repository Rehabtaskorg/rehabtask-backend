import {
    getAllTierRates,
    setTierCommissionRate,
    getCommissionHistory,
    getCommissionRateByTier,
} from "../services/commission.service.js";
import { logAction } from "../services/audit.service.js";
import { sendCommissionRateChanged } from "../services/email.service.js";
import { prisma } from "../config/prisma.js";

/**
 * GET /admin/commission/rates
 * Returns the current effective rate for each plan tier (basic, pro, elite).
 */
const getAllTierRatesController = async (_req, res, next) => {
    try {
        const rates = await getAllTierRates();
        res.status(200).json({ success: true, data: rates });
    } catch (error) {
        next(error);
    }
};

/**
 * POST /admin/commission/rates
 * Set a new commission rate for a specific plan tier.
 * Body: { tier: "basic"|"pro"|"elite", rate: 0–1, effectiveFrom?: ISO date }
 */
const setTierCommissionRateController = async (req, res, next) => {
    try {
        const adminId = req.user.id;
        const { tier, rate, effectiveFrom } = req.body;

        // Capture current rate before the update so the email can show before/after
        const oldRate = await getCommissionRateByTier(tier);

        const config = await setTierCommissionRate(tier, rate, adminId, effectiveFrom);

        await logAction({
            actorId: adminId,
            action: "commission.rate_updated",
            entityType: "commission",
            entityId: config.id,  // UUID of the new CommissionConfig record
            changes: { tier, rate: { from: oldRate, to: rate }, effectiveFrom: config.effectiveFrom },
        });

        // Notify all approved therapists on this tier — fire-and-forget
        prisma.therapistProfile.findMany({
            where: { planTier: tier, approvalStatus: "approved" },
            select: { fullName: true, user: { select: { email: true } } },
        }).then((therapists) => {
            if (therapists.length > 0) {
                sendCommissionRateChanged({
                    therapists,
                    tier,
                    oldRate,
                    newRate: rate,
                    effectiveFrom: effectiveFrom ? new Date(effectiveFrom) : new Date(),
                }).catch(() => {});
            }
        }).catch(() => {});

        res.status(201).json({ success: true, data: config });
    } catch (error) {
        next(error);
    }
};

/**
 * GET /admin/commission/history
 * Paginated rate-change history, optionally filtered by tier.
 * Query: { tier?, page?, limit? }
 */
const getCommissionHistoryController = async (req, res, next) => {
    try {
        const { tier, page, limit } = req.query;
        const result = await getCommissionHistory({
            tier: tier || undefined,
            page: parseInt(page) || 1,
            limit: Math.min(parseInt(limit) || 20, 100),
        });
        res.status(200).json({ success: true, data: result });
    } catch (error) {
        next(error);
    }
};

export {
    getAllTierRatesController,
    setTierCommissionRateController,
    getCommissionHistoryController,
};
