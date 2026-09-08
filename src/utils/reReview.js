import { APPROVAL_STATUS } from "./constants.js";
import { FIELD_TIER } from "./fieldPolicy.js";
import { logAction } from "../services/audit.service.js";
import { logger } from "../config/logger.js";

/**
 * Build the profile-update payload that flags an approved account for re-review.
 * @param {Set<string>} reReviewTiers - from partitionByPolicy()
 * @returns {Object} partial Prisma update payload (empty when nothing to flag)
 */
export const buildReReviewPayload = (reReviewTiers) => {
    if (!reReviewTiers || reReviewTiers.size === 0) return {};

    const payload = { pendingReviewAt: new Date() };

    if (reReviewTiers.has(FIELD_TIER.VERIFIED_HARD)) {
        payload.licenseVerified = false;
        payload.insuranceVerified = false;
        payload.approvalStatus = APPROVAL_STATUS.REVIEW;
    }

    return payload;
};

/**
 * Audit + notify after a re-review flag has been persisted.
 * Fire-and-forget: never blocks or fails the user's save.
 *
 * @param {{actorId: string, entityType: "therapist_profile"|"customer_profile",
 *          entityId: string, changedFields: string[], tiers: Set<string>}} args
 */
export const recordReReview = async ({ actorId, entityType, entityId, changedFields, tiers }) => {
    const isHard = tiers.has(FIELD_TIER.VERIFIED_HARD);

    await logAction({
        actorId,
        action: isHard ? "profile.re_review_hard" : "profile.re_review_soft",
        entityType,
        entityId,
        changes: { fields: changedFields, tier: isHard ? "hard" : "soft" },
    });

    logger.info("[ReReview] Profile flagged for re-review", {
        entityType, entityId, tier: isHard ? "hard" : "soft", fieldCount: changedFields.length,
    });

    // TODO: [NEXT] Admin notification — templates built in 2c, intentionally not
    // sending. Blocked on confirming the admin inbox address. To enable, uncomment:
    //
    // await sendAdminReReviewNotification({
    //     entityType, entityId, tier: isHard ? "hard" : "soft", changedFields,
    // }).catch(() => {});
};
