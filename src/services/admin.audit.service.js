import { prisma } from "../config/prisma.js";

export const adminListAuditLogs = async ({
    entityType,
    action,
    startDate,
    endDate,
    page = 1,
    limit = 50,
} = {}) => {
    const where = {};

    if (entityType) where.entityType = entityType;

    // Support partial action match (e.g. "payment" matches "payment.released")
    if (action) {
        where.action = { contains: action, mode: "insensitive" };
    }

    if (startDate || endDate) {
        where.createdAt = {};
        if (startDate) {
            where.createdAt.gte = new Date(startDate);
        }
        if (endDate) {
            const end = new Date(endDate);
            end.setUTCHours(23, 59, 59, 999);
            where.createdAt.lte = end;
        }
    }

    const [logs, total] = await Promise.all([
        prisma.auditLog.findMany({
            where,
            include: {
                actor: { select: { id: true, email: true, role: true } },
            },
            orderBy: { createdAt: "desc" },
            skip: (page - 1) * limit,
            take: limit,
        }),
        prisma.auditLog.count({ where }),
    ]);

    return {
        logs,
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
};
