import { adminListAuditLogs as adminListAuditLogsService } from "../services/admin.audit.service.js";

const adminListAuditLogsController = async (req, res, next) => {
    try {
        const { entityType, action, startDate, endDate, page, limit } = req.query;
        const result = await adminListAuditLogsService({
            entityType,
            action,
            startDate,
            endDate,
            page: parseInt(page) || 1,
            limit: Math.min(parseInt(limit) || 50, 100),
        });
        res.status(200).json({ success: true, data: result });
    } catch (error) {
        next(error);
    }
};

export { adminListAuditLogsController };
