import {
    getCustomerProfile as getCustomerProfileService,
    updateCustomerProfile as updateCustomerProfileService,
} from "../services/customer.service.js";

/**
 * GET /api/customers/profile
 * Authenticated customer fetches their own profile.
 */
export const getCustomerProfileController = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const profile = await getCustomerProfileService(userId);
        res.status(200).json({ success: true, data: profile });
    } catch (error) {
        next(error);
    }
};

/**
 * PUT /api/customers/profile
 * Authenticated customer updates their own profile fields.
 */
export const updateCustomerProfileController = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const profile = await updateCustomerProfileService(userId, req.body);
        res.status(200).json({ success: true, data: profile });
    } catch (error) {
        next(error);
    }
};