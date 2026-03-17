import {
    getActiveFaqs as getActiveFaqsService,
    getAllFaqs as getAllFaqsService,
    createFaq as createFaqService,
    updateFaq as updateFaqService,
    deleteFaq as deleteFaqService,
} from "../services/faq.service.js";

const getActiveFaqsController = async (req, res, next) => {
    try {
        const faqs = await getActiveFaqsService();
        res.status(200).json({ success: true, data: faqs });
    } catch (error) {
        next(error);
    }
}

const getAllFaqsController = async (req, res, next) => {
    try {
        const faqs = await getAllFaqsService();
        res.status(200).json({ success: true, data: faqs });
    } catch (error) {
        next(error);
    }
}

const createFaqController = async (req, res, next) => {
    try {
        const faq = await createFaqService(req.body);
        res.status(201).json({ success: true, data: faq });
    } catch (error) {
        next(error);
    }
}

const updateFaqController = async (req, res, next) => {
    try {
        const { faqId } = req.params;
        const faq = await updateFaqService(faqId, req.body);
        res.status(200).json({ success: true, data: faq });
    } catch (error) {
        next(error);
    }
}

const deleteFaqController = async (req, res, next) => {
    try {
        const { faqId } = req.params;
        const result = await deleteFaqService(faqId);
        res.status(200).json({ success: true, data: result });
    } catch (error) {
        next(error);
    }
}

export {
    getActiveFaqsController,
    getAllFaqsController,
    createFaqController,
    updateFaqController,
    deleteFaqController,
}