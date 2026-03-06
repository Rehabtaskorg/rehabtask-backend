import {
    listUsers as listUsersService,
    getUserDetail as getUserDetailService,
    deactivateUser as deactivateUserService,
    reactivateUser as reactivateUserService,
    updateUser as updateUserService,
} from "../services/admin.user.service.js";

const listUsersController = async (req, res, next) => {
    try {
        const { role, isActive, search, page, limit } = req.query;
        const result = await listUsersService({
            role,
            isActive: isActive !== undefined ? isActive === "true" : undefined,
            search,
            page: parseInt(page) || 1,
            limit: Math.min(parseInt(limit) || 20, 100),
        });
        res.status(200).json({ success: true, data: result });
    } catch (error) {
        next(error);
    }
};

const getUserDetailController = async (req, res, next) => {
    try {
        const { userId } = req.params;
        const user = await getUserDetailService(userId);
        res.status(200).json({ success: true, data: user });
    } catch (error) {
        next(error);
    }
};

const deactivateUserController = async (req, res, next) => {
    try {
        const adminId = req.user.id;
        const { userId } = req.params;
        const user = await deactivateUserService(userId, adminId, req.user.role);
        res.status(200).json({ success: true, data: user });
    } catch (error) {
        next(error);
    }
};

const reactivateUserController = async (req, res, next) => {
    try {
        const adminId = req.user.id;
        const { userId } = req.params;
        const user = await reactivateUserService(userId, adminId);
        res.status(200).json({ success: true, data: user });
    } catch (error) {
        next(error);
    }
};

const updateUserController = async (req, res, next) => {
    try {
        const adminId = req.user.id;
        const { userId } = req.params;
        const user = await updateUserService(userId, req.body, adminId);
        res.status(200).json({ success: true, data: user });
    } catch (error) {
        next(error);
    }
};

export {
    listUsersController,
    getUserDetailController,
    deactivateUserController,
    reactivateUserController,
    updateUserController,
};