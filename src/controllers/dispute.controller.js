import {
    createDispute as createDisputeService,
    getUserDisputes as getUserDisputesService,
    getDisputeById as getDisputeByIdService,
    getAllDisputes as getAllDisputesService,
    resolveDispute as resolveDisputeService,
} from "../services/dispute.service.js";

const createDisputeController = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const dispute = await createDisputeService(userId, req.body);
        res.status(201).json({ success: true, data: dispute });
    } catch (error) {
        next(error);
    }
}

const getUserDisputesController = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const disputes = await getUserDisputesService(userId);
        res.status(200).json({ success: true, data: disputes });
    } catch (error) {
        next(error);
    }
}

const getDisputeByIdController = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const userRole = req.user.role;
        const { disputeId } = req.params;
        const dispute = await getDisputeByIdService(disputeId, userId, userRole);
        res.status(200).json({ success: true, data: dispute });
    } catch (error) {
        next(error);
    }
}

const getAllDisputesController = async (req, res, next) => {
    try {
        const { status, page, limit } = req.query;
        const result = await getAllDisputesService({ status, page, limit });
        res.status(200).json({ success: true, data: result });
    } catch (error) {
        next(error);
    }
}

const resolveDisputeController = async (req, res, next) => {
    try {
        const adminUserId = req.user.id;
        const { disputeId } = req.params;
        const dispute = await resolveDisputeService(disputeId, adminUserId, req.body);
        res.status(200).json({ success: true, data: dispute });
    } catch (error) {
        next(error);
    }
};

export {
    createDisputeController,
    getUserDisputesController,
    getDisputeByIdController,
    getAllDisputesController,
    resolveDisputeController,
}