import {
    getCommissionRate,
    getCommissionRateWithMeta,
    setCommissionRate,
    getCommissionHistory,
} from "../services/commission.service.js";
import { logAction } from "../services/audit.service.js";
import { sendCommissionRateChanged } from "../services/email.service.js";
import { prisma } from "../config/prisma.js";

/**
 * GET /admin/commission/rates
 * Returns the current global commission rate.
 */
const getCommissionRateController = async (_req, res, next) => {
    try {
        const rate = await getCommissionRateWithMeta();
        res.status(200).json({ success: true, data: rate });
    } catch (error) {
        next(error);
    }
};

/**
 * POST /admin/commission/rates
 * Set a new global commission rate.
 * Body: { rate: 0-1, effectiveFrom?: ISO date }
 */
const setCommissionRateController = async (req, res, next) => {
    try {
        const adminId = req.user.id;
        const { rate, effectiveFrom } = req.body;

        const oldRate = await getCommissionRate();

        const config = await setCommissionRate(rate, adminId, effectiveFrom);

        await logAction({
            actorId: adminId,
            action: "commission.rate_updated",
            entityType: "commission",
            entityId: config.id,
            changes: { rate: { from: oldRate, to: rate }, effectiveFrom: config.effectiveFrom },
        });

        // Notify all approved therapists — fire-and-forget
        prisma.therapistProfile.findMany({
            where: { approvalStatus: "approved" },
            select: { fullName: true, user: { select: { email: true } } },
        }).then((therapists) => {
            if (therapists.length > 0) {
                sendCommissionRateChanged({
                    therapists,
                    tier: null,
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
 * Paginated rate-change history.
 */
const getCommissionHistoryController = async (req, res, next) => {
    try {
        const { page, limit } = req.query;
        const result = await getCommissionHistory({
            page: parseInt(page) || 1,
            limit: Math.min(parseInt(limit) || 20, 100),
        });
        res.status(200).json({ success: true, data: result });
    } catch (error) {
        next(error);
    }
};

export {
    getCommissionRateController,
    setCommissionRateController,
    getCommissionHistoryController,
};