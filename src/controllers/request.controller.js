import { createRequest, getAvailableRequests, getCustomerRequests, getRequestById, updateRequest, cancelRequest, getOpenRequestsByCustomerUserId } from "../services/request.service.js";

/**
 * Create a new request
 */
const createRequestController = async (req, res, next) => {
    try {
        const customerId = req.user.customerProfile.id;
        const request = await createRequest(customerId, req.body, req.user.customerProfile);

        res.status(201).json({ success: true, data: request });
    } catch (error) {
        next(error);
    }
}

/**
 * Get all requests for a customer
 */
const getCustomerRequestsController = async (req, res, next) => {
    try {
        const customerId = req.user.customerProfile.id;
        const { status, serviceType, page, limit } = req.query;
        const result = await getCustomerRequests(customerId, {
            status,
            serviceType,
            page: page ? parseInt(page) : 1,
            limit: limit ? parseInt(limit) : 20,
        });

        res.status(200).json({ success: true, data: result });
    } catch (error) {
        next(error);
    }
}

/**
 * Get a single request by ID
 */
const getRequestByIdController = async (req, res, next) => {
    try {
        const { requestId } = req.params;
        const userId = req.user.id;

        const request = await getRequestById(requestId, userId);

        res.status(200).json({ success: true, data: request });
    } catch (error) {
        next(error);
    }
}

/**
 * Get all available requests for a therapist
 */
const getAvailableRequestsController = async (req, res, next) => {
    try {
        const therapistId = req.user.therapistProfile.id;
        const primaryLicenseType = req.user.therapistProfile.primaryLicenseType;
        const { serviceType, show, page, limit } = req.query;
        const result = await getAvailableRequests(therapistId, {
            primaryLicenseType,
            serviceType,
            show,
            page: page ? parseInt(page) : 1,
            limit: limit ? parseInt(limit) : 20,
        });

        res.status(200).json({ success: true, data: result });
    } catch (error) {
        next(error);
    }
};

/**
 * Update an existing request
 */
const updateRequestController = async (req, res, next) => {
    try {
        const { requestId } = req.params;
        const customerId = req.user.customerProfile.id;
        const request = await updateRequest(requestId, customerId, req.body, req.user.customerProfile);

        res.status(200).json({ success: true, data: request });
    } catch (error) {
        next(error);
    }
};

/**
 * Cancel a request
 */
const cancelRequestController = async (req, res, next) => {
    try {
        const { requestId } = req.params;
        const customerId = req.user.customerProfile.id;
        const result = await cancelRequest(requestId, customerId);

        res.status(200).json({ success: true, data: result, message: "Request cancelled successfully" });
    } catch (error) {
        next(error);
    }
};

/**
 * Get open requests for a specific customer (therapist-facing, used in messaging sidebar)
 */
const getCustomerOpenRequestsController = async (req, res, next) => {
    try {
        const { customerUserId } = req.params;
        const therapistId = req.user.therapistProfile.id;
        const requests = await getOpenRequestsByCustomerUserId(customerUserId, therapistId);

        res.status(200).json({ success: true, data: requests });
    } catch (error) {
        next(error);
    }
};

export {
    createRequestController,
    getCustomerRequestsController,
    getRequestByIdController,
    getAvailableRequestsController,
    updateRequestController,
    cancelRequestController,
    getCustomerOpenRequestsController,
}