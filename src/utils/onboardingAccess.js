import { APPROVAL_STATUS } from "./constants.js";
import { AuthorizationError } from "./errors.js";

export const ONBOARDING_LOCKED_STATUSES = [APPROVAL_STATUS.REVIEW, APPROVAL_STATUS.APPROVED];

/**
 * @param {{approvalStatus: string}} therapistProfile - already-fetched profile
 * @throws {AuthorizationError}
 */
export const assertOnboardingMutable = (therapistProfile) => {
    if (ONBOARDING_LOCKED_STATUSES.includes(therapistProfile?.approvalStatus)) {
        throw new AuthorizationError(
            "Your application is under review or already approved. Update your profile instead."
        );
    }
};
