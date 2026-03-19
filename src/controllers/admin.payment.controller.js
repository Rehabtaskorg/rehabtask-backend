import {
    adminListPayments as adminListPaymentsService,
    adminGetPayment as adminGetPaymentService,
    adminGetPaymentStats as adminGetPaymentStatsService,
    adminReleasePayment as adminReleasePaymentService,
    adminReleaseRemainder as adminReleaseRemainderService,
    adminRefundPayment as adminRefundPaymentService,
} from "../services/admin.payment.service.js";
import { logAction } from "../services/audit.service.js";

const adminListPaymentsController = async (req, res, next) => {
    try {
        const { status, search, sortBy, sortOrder, startDate, endDate, page, limit } = req.query;
        const result = await adminListPaymentsService({
            status,
            search,
            sortBy,
            sortOrder,
            startDate,
            endDate,
            page: parseInt(page) || 1,
            limit: Math.min(parseInt(limit) || 20, 100),
        });
        res.status(200).json({ success: true, data: result });
    } catch (error) {
        next(error);
    }
};

const adminGetPaymentController = async (req, res, next) => {
    try {
        const { paymentId } = req.params;
        const payment = await adminGetPaymentService(paymentId);
        res.status(200).json({ success: true, data: payment });
    } catch (error) {
        next(error);
    }
};

const adminGetPaymentStatsController = async (req, res, next) => {
    try {
        const stats = await adminGetPaymentStatsService();
        res.status(200).json({ success: true, data: stats });
    } catch (error) {
        next(error);
    }
};

const adminReleasePaymentController = async (req, res, next) => {
    try {
        const adminId = req.user.id;
        const { paymentId } = req.params;
        const { amount } = req.body;
        const payment = await adminReleasePaymentService(paymentId, adminId, amount);
        const isPartial = amount !== undefined && amount < parseFloat(payment.therapistPayout);
        await logAction({
            actorId: adminId,
            action: "payment.released",
            entityType: "payment",
            entityId: paymentId,
            changes: {
                status: { from: "escrowed", to: isPartial ? "partially_released" : "released" },
                releasedAmount: parseFloat(payment.releasedAmount),
                fullPayout: parseFloat(payment.therapistPayout),
                partial: isPartial,
            },
        });
        res.status(200).json({ success: true, data: payment });
    } catch (error) {
        next(error);
    }
};

const adminRefundPaymentController = async (req, res, next) => {
    try {
        const adminId = req.user.id;
        const { paymentId } = req.params;
        const { reason } = req.body;
        const refund = await adminRefundPaymentService(paymentId, reason, adminId);
        await logAction({
            actorId: adminId,
            action: "payment.refunded",
            entityType: "payment",
            entityId: paymentId,
            changes: { status: { from: "escrowed", to: "refunded" }, reason },
        });
        res.status(200).json({ success: true, data: refund });
    } catch (error) {
        next(error);
    }
};

const adminReleaseRemainderController = async (req, res, next) => {
    try {
        const adminId = req.user.id;
        const { paymentId } = req.params;
        const payment = await adminReleaseRemainderService(paymentId, adminId);
        await logAction({
            actorId: adminId,
            action: "payment.remainder_released",
            entityType: "payment",
            entityId: paymentId,
            changes: {
                status: { from: "partially_released", to: "released" },
                releasedAmount: parseFloat(payment.releasedAmount),
                fullPayout: parseFloat(payment.therapistPayout),
            },
        });
        res.status(200).json({ success: true, data: payment });
    } catch (error) {
        next(error);
    }
};

export {
    adminListPaymentsController,
    adminGetPaymentController,
    adminGetPaymentStatsController,
    adminReleasePaymentController,
    adminReleaseRemainderController,
    adminRefundPaymentController,
};
