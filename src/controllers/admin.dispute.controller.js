import {
    adminListDisputes as adminListDisputesService,
    adminGetDispute as adminGetDisputeService,
    assignDispute as assignDisputeService,
    adminUpdateDispute as adminUpdateDisputeService,
    reopenDispute as reopenDisputeService,
} from "../services/admin.dispute.service.js";

const adminListDisputesController = async (req, res, next) => {
    try {
        const { status, assignedAdminId, unassigned, page, limit } = req.query;
        const result = await adminListDisputesService({
            status,
            assignedAdminId,
            unassigned: unassigned === "true",
            page: parseInt(page) || 1,
            limit: Math.min(parseInt(limit) || 20, 100),
            callerRole: req.user.role,
            callerUserId: req.user.id,
        });
        res.status(200).json({ success: true, data: result });
    } catch (error) {
        next(error);
    }
};

const adminGetDisputeController = async (req, res, next) => {
    try {
        const { disputeId } = req.params;
        const dispute = await adminGetDisputeService(disputeId, req.user.role, req.user.id);
        res.status(200).json({ success: true, data: dispute });
    } catch (error) {
        next(error);
    }
};

const assignDisputeController = async (req, res, next) => {
    try {
        const byAdminId = req.user.id;
        const { disputeId } = req.params;
        const { assignedAdminId } = req.body;
        const dispute = await assignDisputeService(disputeId, assignedAdminId, byAdminId, req.user.role);
        res.status(200).json({ success: true, data: dispute });
    } catch (error) {
        next(error);
    }
};

const adminUpdateDisputeController = async (req, res, next) => {
    try {
        const adminUserId = req.user.id;
        const { disputeId } = req.params;
        const dispute = await adminUpdateDisputeService(disputeId, adminUserId, req.body, req.user.role);
        res.status(200).json({ success: true, data: dispute });
    } catch (error) {
        next(error);
    }
};

const reopenDisputeController = async (req, res, next) => {
    try {
        const adminUserId = req.user.id;
        const { disputeId } = req.params;
        const dispute = await reopenDisputeService(disputeId, adminUserId, req.user.role);
        res.status(200).json({ success: true, data: dispute });
    } catch (error) {
        next(error);
    }
};

export {
    adminListDisputesController,
    adminGetDisputeController,
    assignDisputeController,
    adminUpdateDisputeController,
    reopenDisputeController,
};