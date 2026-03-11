import {
    listTherapists as listTherapistsService,
    getTherapistDetail as getTherapistDetailService,
    approveTherapist as approveTherapistService,
    rejectTherapist as rejectTherapistService,
    getDocumentSignedUrl as getDocumentSignedUrlService,
    adminUpdateTherapistPlan as adminUpdateTherapistPlanService,
    getTherapistPlanStats as getTherapistPlanStatsService,
} from "../services/admin.therapist.service.js";
import { logAction } from "../services/audit.service.js";

const listTherapistsController = async (req, res, next) => {
    try {
        const { approvalStatus, planTier, search, page, limit } = req.query;
        const result = await listTherapistsService({
            approvalStatus,
            planTier,
            search,
            page: parseInt(page) || 1,
            limit: Math.min(parseInt(limit) || 20, 100),
        });
        res.status(200).json({ success: true, data: result });
    } catch (error) {
        next(error);
    }
};

const getTherapistPlanStatsController = async (_req, res, next) => {
    try {
        const stats = await getTherapistPlanStatsService();
        res.status(200).json({ success: true, data: stats });
    } catch (error) {
        next(error);
    }
};

const getTherapistDetailController = async (req, res, next) => {
    try {
        const { therapistUserId } = req.params;
        const therapist = await getTherapistDetailService(therapistUserId);
        res.status(200).json({ success: true, data: therapist });
    } catch (error) {
        next(error);
    }
};

const approveTherapistController = async (req, res, next) => {
    try {
        const adminId = req.user.id;
        const { therapistUserId } = req.params;
        const therapist = await approveTherapistService(therapistUserId, adminId);
        await logAction({
            actorId: adminId,
            action: "therapist.approved",
            entityType: "therapist",
            entityId: therapistUserId,
            changes: { approvalStatus: { to: "approved" } },
        });
        res.status(200).json({ success: true, data: therapist });
    } catch (error) {
        next(error);
    }
};

const rejectTherapistController = async (req, res, next) => {
    try {
        const adminId = req.user.id;
        const { therapistUserId } = req.params;
        const { reason } = req.body;
        const therapist = await rejectTherapistService(therapistUserId, reason, adminId);
        await logAction({
            actorId: adminId,
            action: "therapist.rejected",
            entityType: "therapist",
            entityId: therapistUserId,
            changes: { approvalStatus: { to: "rejected" }, reason },
        });
        res.status(200).json({ success: true, data: therapist });
    } catch (error) {
        next(error);
    }
};

const getDocumentSignedUrlController = async (req, res, next) => {
    try {
        const { therapistUserId, documentId } = req.params;
        const result = await getDocumentSignedUrlService(therapistUserId, documentId);
        res.status(200).json({ success: true, data: result });
    } catch (error) {
        next(error);
    }
};

const updateTherapistPlanController = async (req, res, next) => {
    try {
        const adminId = req.user.id;
        const { therapistUserId } = req.params;
        const { planTier } = req.body;
        const { updated, previousTier } = await adminUpdateTherapistPlanService(therapistUserId, planTier, adminId);
        await logAction({
            actorId: adminId,
            action: "therapist.plan_updated",
            entityType: "therapist",
            entityId: therapistUserId,
            changes: { planTier: { from: previousTier, to: planTier } },
        });
        res.status(200).json({ success: true, data: updated });
    } catch (error) {
        next(error);
    }
};

export {
    listTherapistsController,
    getTherapistDetailController,
    approveTherapistController,
    rejectTherapistController,
    getDocumentSignedUrlController,
    updateTherapistPlanController,
    getTherapistPlanStatsController,
};
