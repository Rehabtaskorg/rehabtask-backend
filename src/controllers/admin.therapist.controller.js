import {
    listTherapists as listTherapistsService,
    getTherapistDetail as getTherapistDetailService,
    approveTherapist as approveTherapistService,
    rejectTherapist as rejectTherapistService,
    getDocumentSignedUrl as getDocumentSignedUrlService,
} from "../services/admin.therapist.service.js";
import { logAction } from "../services/audit.service.js";

const listTherapistsController = async (req, res, next) => {
    try {
        const { approvalStatus, search, page, limit } = req.query;
        const result = await listTherapistsService({
            approvalStatus,
            search,
            page: parseInt(page) || 1,
            limit: Math.min(parseInt(limit) || 20, 100),
        });
        res.status(200).json({ success: true, data: result });
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

export {
    listTherapistsController,
    getTherapistDetailController,
    approveTherapistController,
    rejectTherapistController,
    getDocumentSignedUrlController,
};