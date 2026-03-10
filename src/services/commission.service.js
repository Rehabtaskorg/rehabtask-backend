import { prisma } from "../config/prisma.js";
import { BadRequestError } from "../utils/errors.js";
import { logger } from "../config/logger.js";

// PRD default rates: Basic 20%, Pro 12%, Elite 7%
export const TIER_DEFAULT_RATES = {
    basic: 0.2,
    pro: 0.12,
    elite: 0.07,
};

const VALID_TIERS = ["basic", "pro", "elite"];

/**
 * Get the current active commission rate for a specific therapist plan tier.
 * Returns the most recent CommissionConfig where tier matches and effectiveFrom <= now.
 * Falls back to TIER_DEFAULT_RATES if no DB record is seeded yet.
 */
export const getCommissionRateByTier = async (tier) => {
    if (!VALID_TIERS.includes(tier)) {
        throw new BadRequestError(`Invalid tier '${tier}'. Must be one of: ${VALID_TIERS.join(", ")}`);
    }

    const config = await prisma.commissionConfig.findFirst({
        where: {
            tier,
            effectiveFrom: { lte: new Date() },
        },
        orderBy: { effectiveFrom: "desc" },
    });

    if (config) {
        return parseFloat(config.rate);
    }

    // Safe fallback: use PRD defaults if DB has no record for this tier yet
    logger.warn("[CommissionService] No DB rate found for tier, using PRD default", { tier });
    return TIER_DEFAULT_RATES[tier];
};

/**
 * Get current commission rates for all three tiers.
 * Returns an array of { tier, rate, effectiveFrom, createdByAdmin } objects.
 * Tiers with no DB record use the PRD default rate.
 */
export const getAllTierRates = async () => {
    const now = new Date();

    const records = await Promise.all(
        VALID_TIERS.map((tier) =>
            prisma.commissionConfig.findFirst({
                where: { tier, effectiveFrom: { lte: now } },
                orderBy: { effectiveFrom: "desc" },
                include: {
                    createdByAdmin: { select: { id: true, email: true } },
                },
            })
        )
    );

    return VALID_TIERS.map((tier, i) => {
        const rec = records[i];
        const createdByAdmin = rec ? (/** @type {any} */ (rec)).createdByAdmin ?? null : null;
        return {
            tier,
            rate: rec ? parseFloat(rec.rate) : TIER_DEFAULT_RATES[tier],
            effectiveFrom: rec?.effectiveFrom ?? null,
            createdByAdmin,
            isDefault: !rec,
        };
    });
};

/**
 * Set a commission rate for a specific plan tier.
 * Creates a new history record (append-only audit trail).
 *
 * @param {string} tier - "basic" | "pro" | "elite"
 * @param {number} rate - Decimal 0–1 (e.g. 0.12 = 12%)
 * @param {string} adminId - Admin user ID performing the update
 * @param {string|Date|undefined} effectiveFrom - ISO date or Date; defaults to now
 */
export const setTierCommissionRate = async (tier, rate, adminId, effectiveFrom) => {
    if (!VALID_TIERS.includes(tier)) {
        throw new BadRequestError(`Invalid tier '${tier}'. Must be one of: ${VALID_TIERS.join(", ")}`);
    }
    if (rate < 0 || rate > 1) {
        throw new BadRequestError("Commission rate must be between 0 and 1 (e.g. 0.12 for 12%)");
    }

    const effective = effectiveFrom ? new Date(effectiveFrom) : new Date();
    if (isNaN(effective.getTime())) {
        throw new BadRequestError("Invalid effectiveFrom date");
    }

    const config = await prisma.commissionConfig.create({
        data: {
            tier,
            rate,
            effectiveFrom: effective,
            createdByAdminId: adminId,
        },
        include: {
            createdByAdmin: { select: { id: true, email: true } },
        },
    });

    logger.info("[CommissionService] Tier commission rate updated", {
        tier,
        rate,
        effectiveFrom: effective,
        byAdmin: adminId,
    });

    return config;
};

/**
 * Paginated commission rate history, optionally filtered by tier.
 *
 * @param {{ tier?: string, page?: number, limit?: number }} params
 */
export const getCommissionHistory = async ({ tier, page = 1, limit = 20 } = {}) => {
    const where = tier ? { tier } : {};

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

/**
 * @deprecated — kept for backward compatibility.
 * Returns the most recent global (null-tier) CommissionConfig record, if any.
 */
export const getCurrentCommissionRate = async () => {
    return prisma.commissionConfig.findFirst({
        where: { tier: null, effectiveFrom: { lte: new Date() } },
        orderBy: { effectiveFrom: "desc" },
        include: {
            createdByAdmin: { select: { id: true, email: true } },
        },
    });
};
