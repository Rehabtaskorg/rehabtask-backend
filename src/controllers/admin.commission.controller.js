import {
    getAllTierRates,
    setTierCommissionRate,
    getCommissionHistory,
} from "../services/commission.service.js";

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
        const config = await setTierCommissionRate(tier, rate, adminId, effectiveFrom);
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
