import { browsePublicRequests } from "../services/publicRequest.service.js";

export const browsePublicRequestsController = async (req, res, next) => {
    try {
        const { serviceType, search, page, limit } = req.query;
        const result = await browsePublicRequests({
            serviceType,
            search,
            page: page ? parseInt(page) : 1,
            limit: limit ? parseInt(limit) : 10,
        });
        res.status(200).json({ success: true, data: result });
    } catch (error) {
        console.error("[PublicRequests] Error:", error.message);
        next(error);
    }
};
