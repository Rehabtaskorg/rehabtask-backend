import { prisma } from "../config/prisma.js";
import { BadRequestError } from "../utils/errors.js";
import { logger } from "../config/logger.js";

/**
 * Get the current active commission rate
 * Returns the most recent CommissionConfig where effectiveFrom <= now.
 */
export const getCurrentCommissionRate = async () => {
    const config = await prisma.commissionConfig.findFirst({
        where: { effectiveFrom: { lte: new Date() } },
        orderBy: { effectiveFrom: "desc" },
        include: {
            createdByAdmin: { select: { id: true, email: true } },
        },
    });
    return config ?? null;
}

/**
 * Get full commission rate history, paginated
 */
export const getCommissionHistory = async ({ page = 1, limit = 20 }) => {
    const [configs, total] = await Promise.all([
        prisma.commissionConfig.findMany({
            orderBy: { effectiveFrom: "desc" },
            include: {
                createdByAdmin: { select: { id: true, email: true } },
            },
            skip: (page - 1) * limit,
            take: limit,
        }),
        prisma.commissionConfig.count(),
    ]);

    return {
        configs,
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
}

/**
 * Set a new commission rate
 * @param {number} rate - Decimal 0-1 (e.g 0.15 = 15%)
 * @param {string} adminId - Admin user ID
 * @param {string|Date|undefined} effectiveFrom - ISO date string or Date; defaults to now
 */
export const setCommissionRate = async (rate, adminId, effectiveFrom) => {
    if (rate < 0 || rate > 1) {
        throw new BadRequestError(
            "Commission rate must be between 0 and 1 (e.g. 0.15 for 15%)"
        );
    }

    const effective = effectiveFrom ? new Date(effectiveFrom) : new Date();
    if (isNaN(effective.getTime())) {
        throw new BadRequestError("Invalid effectiveFrom date");
    }

    const config = await prisma.commissionConfig.create({
        data: {
            rate,
            effectiveFrom: effective,
            createdByAdminId: adminId,
        },
        include: {
            createdByAdmin: { select: { id: true, email: true } },
        },
    });

    logger.info("[CommissionService] Commission rate updated", {
        rate,
        effectiveFrom: effective,
        byAdmin: adminId,
    });
    return config;
}