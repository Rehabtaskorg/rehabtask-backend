import {
    getCurrentCommissionRate as getCurrentCommissionRateService,
    getCommissionHistory as getCommissionHistoryService,
    setCommissionRate as setCommissionRateService,
} from "../services/commission.service.js";

const getCommissionRateController = async (req, res, next) => {
    try {
        const rate = await getCurrentCommissionRateService();
        res.status(200).json({ success: true, data: rate });
    } catch (error) {
        next(error);
    }
};

const getCommissionHistoryController = async (req, res, next) => {
    try {
        const { page, limit } = req.query;
        const result = await getCommissionHistoryService({
            page: parseInt(page) || 1,
            limit: Math.min(parseInt(limit) || 20, 100),
        });
        res.status(200).json({ success: true, data: result });
    } catch (error) {
        next(error);
    }
};

const setCommissionRateController = async (req, res, next) => {
    try {
        const adminId = req.user.id;
        const { rate, effectiveFrom } = req.body;
        const config = await setCommissionRateService(rate, adminId, effectiveFrom);
        res.status(201).json({ success: true, data: config });
    } catch (error) {
        next(error);
    }
};

export {
    getCommissionRateController,
    getCommissionHistoryController,
    setCommissionRateController,
};