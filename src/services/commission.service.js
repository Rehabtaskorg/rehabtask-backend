import { prisma } from "../config/prisma.js";
import { BadRequestError } from "../utils/errors.js";
import { logger } from "../config/logger.js";

// Default platform commission rate (10%)
const DEFAULT_COMMISSION_RATE = 0.1;

/**
 * Get the current global commission rate.
 * Returns the most recent CommissionConfig where tier IS NULL and effectiveFrom <= now.
 * Falls back to DEFAULT_COMMISSION_RATE if no DB record exists.
 */
export const getCommissionRate = async () => {
    const config = await prisma.commissionConfig.findFirst({
        where: {
            tier: null,
            effectiveFrom: { lte: new Date() },
        },
        orderBy: { effectiveFrom: "desc" },
    });

    if (config) {
        return parseFloat(config.rate);
    }

    logger.warn("[CommissionService] No DB rate found, using default", { default: DEFAULT_COMMISSION_RATE });
    return DEFAULT_COMMISSION_RATE;
};

/**
 * Get the current commission rate with metadata (for admin UI).
 */
export const getCommissionRateWithMeta = async () => {
    const config = await prisma.commissionConfig.findFirst({
        where: {
            tier: null,
            effectiveFrom: { lte: new Date() },
        },
        orderBy: { effectiveFrom: "desc" },
        include: {
            createdByAdmin: { select: { id: true, email: true } },
        },
    });

    return {
        rate: config ? parseFloat(config.rate) : DEFAULT_COMMISSION_RATE,
        effectiveFrom: config?.effectiveFrom ?? null,
        createdByAdmin: config ? /** @type {any} */ (config).createdByAdmin ?? null : null,
        isDefault: !config,
    };
};

/**
 * Set the global commission rate.
 * Creates a new history record (append-only audit trail).
 * Uses tier = null to indicate global (not tier-specific).
 *
 * @param {number} rate - Decimal 0-1 (e.g. 0.10 = 10%)
 * @param {string} adminId - Admin user ID performing the update
 * @param {string|Date|undefined} effectiveFrom - ISO date or Date; defaults to now
 */
export const setCommissionRate = async (rate, adminId, effectiveFrom) => {
    if (rate < 0 || rate > 1) {
        throw new BadRequestError("Commission rate must be between 0 and 1 (e.g. 0.10 for 10%)");
    }

    const effective = effectiveFrom ? new Date(effectiveFrom) : new Date();
    if (isNaN(effective.getTime())) {
        throw new BadRequestError("Invalid effectiveFrom date");
    }

    const config = await prisma.commissionConfig.create({
        data: {
            tier: null,
            rate,
            effectiveFrom: effective,
            createdByAdminId: adminId,
        },
        include: {
            createdByAdmin: { select: { id: true, email: true } },
        },
    });

    logger.info("[CommissionService] Global commission rate updated", {
        rate,
        effectiveFrom: effective,
        byAdmin: adminId,
    });

    return config;
};

/**
 * Paginated commission rate history.
 */
export const getCommissionHistory = async ({ page = 1, limit = 20 } = {}) => {
    const where = { tier: null };

    const [configs, total] = await Promise.all([
        prisma.commissionConfig.findMany({
            where,
            orderBy: { effectiveFrom: "desc" },
            include: {
                createdByAdmin: { select: { id: true, email: true } },
            },
            skip: (page - 1) * limit,
            take: limit,
        }),
        prisma.commissionConfig.count({ where }),
    ]);

    return {
        configs,
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
};