import { prisma } from "../config/prisma.js";
import { NotFoundError, ValidationError, AuthorizationError } from "../utils/errors.js";
import { logger } from "../config/logger.js";
import { CUSTOMER_FIELD_POLICY, partitionByPolicy } from "../utils/fieldPolicy.js";
import { buildReReviewPayload, recordReReview } from "../utils/reReview.js";

/**
 * Update mutable fields on a customer's own profile.
 * @param {string} userId - Firebase UID from the authenticated request
 * @param {Record<string, unknown>} data - Validated request body
 * @returns {Promise<import("@prisma/client").CustomerProfile>}
 */
export const updateCustomerProfile = async (userId, data) => {
    const profile = await prisma.customerProfile.findUnique({ where: { userId } });
    if (!profile) throw new NotFoundError("Customer profile not found");

    const { writable, reReviewTiers, locked, blocked, unknown } =
        partitionByPolicy(data, CUSTOMER_FIELD_POLICY, profile.approvalStatus);

    if (locked.length > 0 || unknown.length > 0) {
        throw new ValidationError(
            "One or more fields cannot be set directly",
            [...locked, ...unknown].map((field) => ({
                field,
                message: locked.includes(field)
                    ? "This field is managed by the system and cannot be changed"
                    : "Unknown field",
            }))
        );
    }

    if (blocked.length > 0) {
        throw new AuthorizationError(
            `These fields cannot be changed while your application is under review: ${blocked.join(", ")}`
        );
    }

    if (writable.dateOfBirth !== undefined) {
        writable.dateOfBirth = new Date(writable.dateOfBirth);
    }

    const reReviewPayload = buildReReviewPayload(reReviewTiers, { clearVerificationFlags: false });

    const updated = await prisma.customerProfile.update({
        where: { userId },
        data: { ...writable, ...reReviewPayload },
    });

    if (reReviewTiers.size > 0) {
        recordReReview({
            actorId: userId,
            entityType: "customer_profile",
            entityId: profile.id,
            changedFields: Object.keys(writable),
            tiers: reReviewTiers,
        }).catch((err) =>
            logger.error("[CustomerService] recordReReview failed", { error: err.message })
        );
    }

    return updated;
};
