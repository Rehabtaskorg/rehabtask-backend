import {
    getAllFaqs as getAllFaqsService,
    createFaq as createFaqService,
    updateFaq as updateFaqService,
    deleteFaq as deleteFaqService,
} from "../services/faq.service.js";

import {
    getAllDisputes as getAllDisputesService,
    resolveDispute as resolveDisputeService,
} from "../services/dispute.service.js";

// Admin FAQ Controllers

const adminGetAllFaqsController = async (req, res, next) => {
    try {
        const faqs = await getAllFaqsService();
        res.status(200).json({ success: true, data: faqs });
    } catch (error) {
        next(error);
    }
};

const adminCreateFaqController = async (req, res, next) => {
    try {
        const faq = await createFaqService(req.body);
    } catch (error) {
        next(error);
    }
};

const adminUpdateFaqController = async (req, res, next) => {
    try {
        const { faqId } = req.params;
        const faq = await updateFaqService(faqId, req.body);
        res.status(200).json({ success: true, data: faq });
    } catch (error) {
        next(error);
    }
};

const adminDeleteFaqController = async (req, res, next) => {
    try {
        const { faqId } = req.params;
        const result = await deleteFaqService(faqId);
        res.status(200).json({ success: true, data: result });
    } catch (error) {
        next(error);
    }
}

// Admin Dispute Controllers

const adminGetAllDisputesController = async (req, res, next) => {
    try {
        const { status, page, limit } = req.query;
        const result = await getAllDisputesService({ status, page, limit });
        res.status(200).json({ success: true, data: result });
    } catch (error) {
        next(error);
    }
};

const adminResolveDisputeController = async (req, res, next) => {
    try {
        const adminUserId = req.user.id;
        const { disputeId } = req.params;
        const dispute = await resolveDisputeService(
            disputeId,
            adminUserId,
            req.body
        );
        res.status(200).json({ success: true, data: dispute });
    } catch (error) {
        next(error);
    }
};

export {
    adminGetAllFaqsController,
    adminCreateFaqController,
    adminUpdateFaqController,
    adminDeleteFaqController,
    adminGetAllDisputesController,
    adminResolveDisputeController,
}