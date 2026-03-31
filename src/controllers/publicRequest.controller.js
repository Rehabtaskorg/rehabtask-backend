import { browsePublicRequests } from "../services/publicRequest.service.js";

export const browsePublicRequestsController = async (req, res, next) => {
    try {
        const { serviceType, search, latitude, longitude, radiusMiles, page, limit } = req.query;
        const result = await browsePublicRequests({
            serviceType,
            search,
            latitude: latitude ? parseFloat(latitude) : undefined,
            longitude: longitude ? parseFloat(longitude) : undefined,
            radiusMiles: radiusMiles ? parseInt(radiusMiles) : 50,
            page: page ? parseInt(page) : 1,
            limit: limit ? parseInt(limit) : 10,
        });
        res.status(200).json({ success: true, data: result });
    } catch (error) {
        console.error("[PublicRequests] Error:", error.message);
        next(error);
    }
};
