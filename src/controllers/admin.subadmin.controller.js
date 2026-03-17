import {
    listSubAdmins as listSubAdminsService,
    getSubAdminDetail as getSubAdminDetailService,
    createSubAdmin as createSubAdminService,
    promoteToSubAdmin as promoteToSubAdminService,
    updateSubAdminPermissions as updateSubAdminPermissionsService,
    deactivateSubAdmin as deactivateSubAdminService,
    reactivateSubAdmin as reactivateSubAdminService,
    resendSubAdminInvite as resendSubAdminInviteService,
} from "../services/admin.subadmin.service.js";

const listSubAdminsController = async (req, res, next) => {
    try {
        const { isActive, page, limit } = req.query;
        const result = await listSubAdminsService({
            isActive: isActive !== undefined ? isActive === "true" : undefined,
            page: parseInt(page) || 1,
            limit: Math.min(parseInt(limit) || 20, 100),
        });
        res.status(200).json({ success: true, data: result });
    } catch (error) {
        next(error);
    }
};

const getSubAdminDetailController = async (req, res, next) => {
    try {
        const { userId } = req.params;
        const subAdmin = await getSubAdminDetailService(userId);
        res.status(200).json({ success: true, data: subAdmin });
    } catch (error) {
        next(error);
    }
};

const createSubAdminController = async (req, res, next) => {
    try {
        const adminId = req.user.id;
        const { email, permissions } = req.body;
        const subAdmin = await createSubAdminService(email, permissions, adminId);
        res.status(201).json({ success: true, data: subAdmin });
    } catch (error) {
        next(error);
    }
};

const promoteToSubAdminController = async (req, res, next) => {
    try {
        const adminId = req.user.id;
        const { userId } = req.params;
        const { permissions } = req.body;
        const subAdmin = await promoteToSubAdminService(userId, permissions, adminId);
        res.status(200).json({ success: true, data: subAdmin });
    } catch (error) {
        next(error);
    }
};

const updateSubAdminPermissionsController = async (req, res, next) => {
    try {
        const adminId = req.user.id;
        const { userId } = req.params;
        const { permissions } = req.body;
        const result = await updateSubAdminPermissionsService(userId, permissions, adminId);
        res.status(200).json({ success: true, data: result });
    } catch (error) {
        next(error);
    }
};

const deactivateSubAdminController = async (req, res, next) => {
    try {
        const adminId = req.user.id;
        const { userId } = req.params;
        const result = await deactivateSubAdminService(userId, adminId);
        res.status(200).json({ success: true, data: result });
    } catch (error) {
        next(error);
    }
};

const reactivateSubAdminController = async (req, res, next) => {
    try {
        const adminId = req.user.id;
        const { userId } = req.params;
        const result = await reactivateSubAdminService(userId, adminId);
        res.status(200).json({ success: true, data: result });
    } catch (error) {
        next(error);
    }
};

const resendSubAdminInviteController = async (req, res, next) => {
    try {
        const { userId } = req.params;
        const result = await resendSubAdminInviteService(userId);
        res.status(200).json({ success: true, data: result });
    } catch (error) {
        next(error);
    }
};

export {
    listSubAdminsController,
    getSubAdminDetailController,
    createSubAdminController,
    promoteToSubAdminController,
    updateSubAdminPermissionsController,
    deactivateSubAdminController,
    reactivateSubAdminController,
    resendSubAdminInviteController,
};
