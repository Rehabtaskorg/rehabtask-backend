import { APPROVAL_STATUS } from "../utils/constants.js";
import {
    listCustomers as listCustomersService,
    getCustomerDetail as getCustomerDetailService,
    approveCustomer as approveCustomerService,
    rejectCustomer as rejectCustomerService,
    getCustomerDocumentSignedUrl as getCustomerDocumentSignedUrlService,
} from "../services/admin.customer.service.js";
import { logAction } from "../services/audit.service.js";

/**
 * GET /admin/customers
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 * @param {import("express").NextFunction} next
 */
const listCustomersController = async (req, res, next) => {
    try {
        const { approvalStatus, customerType, search, sortOrder, page, limit } = req.query;
        const result = await listCustomersService({
            approvalStatus,
            customerType,
            search,
            sortOrder,
            page: parseInt(page) || 1,
            limit: Math.min(parseInt(limit) || 20, 100),
        });
        res.status(200).json({ success: true, data: result });
    } catch (error) {
        next(error);
    }
};

/**
 * GET /admin/customers/:customerUserId
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 * @param {import("express").NextFunction} next
 */
const getCustomerDetailController = async (req, res, next) => {
    try {
        const { customerUserId } = req.params;
        const customer = await getCustomerDetailService(customerUserId);
        res.status(200).json({ success: true, data: customer });
    } catch (error) {
        next(error);
    }
};

/**
 * PUT /admin/customers/:customerUserId/approve
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 * @param {import("express").NextFunction} next
 */
const approveCustomerController = async (req, res, next) => {
    try {
        const adminId = req.user.id;
        const { customerUserId } = req.params;
        const customer = await approveCustomerService(customerUserId, adminId);
        await logAction({
            actorId: adminId,
            action: "customer.approved",
            entityType: "customer",
            entityId: customerUserId,
            changes: {
                approvalStatus: { to: APPROVAL_STATUS.APPROVED },
                customerType: customer.customerType,
            },
        });
        res.status(200).json({ success: true, data: customer });
    } catch (error) {
        next(error);
    }
};

/**
 * PUT /admin/customers/:customerUserId/reject
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 * @param {import("express").NextFunction} next
 */
const rejectCustomerController = async (req, res, next) => {
    try {
        const adminId = req.user.id;
        const { customerUserId } = req.params;
        const { reason } = req.body;
        const customer = await rejectCustomerService(customerUserId, reason, adminId);
        await logAction({
            actorId: adminId,
            action: "customer.rejected",
            entityType: "customer",
            entityId: customerUserId,
            changes: {
                approvalStatus: { to: APPROVAL_STATUS.REJECTED },
                customerType: customer.customerType,
                reason: customer.rejectionReason,
            },
        });
        res.status(200).json({ success: true, data: customer });
    } catch (error) {
        next(error);
    }
};

/**
 * GET /admin/customers/:customerUserId/documents/:documentId
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 * @param {import("express").NextFunction} next
 */
const getCustomerDocumentSignedUrlController = async (req, res, next) => {
    try {
        const { customerUserId, documentId } = req.params;
        const result = await getCustomerDocumentSignedUrlService(customerUserId, documentId);
        res.status(200).json({ success: true, data: result });
    } catch (error) {
        next(error);
    }
};

export {
    listCustomersController,
    getCustomerDetailController,
    approveCustomerController,
    rejectCustomerController,
    getCustomerDocumentSignedUrlController,
};