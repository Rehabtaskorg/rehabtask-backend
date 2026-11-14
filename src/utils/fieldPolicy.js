import { APPROVAL_STATUS } from "./constants.js";

export const FIELD_TIER = {
    OPEN: "open",
    GUARDED: "guarded",
    VERIFIED_SOFT: "verified_soft",
    VERIFIED_HARD: "verified_hard",
    LOCKED: "locked",
};

const { OPEN, GUARDED, VERIFIED_SOFT, VERIFIED_HARD, LOCKED } = FIELD_TIER;

export const THERAPIST_FIELD_POLICY = {
    fullName: VERIFIED_HARD,
    phone: OPEN,
    smsOptIn: OPEN,
    dateOfBirth: VERIFIED_HARD,
    addressLine1: GUARDED,
    addressLine2: GUARDED,
    city: GUARDED,
    state: GUARDED,
    zipCode: GUARDED,
    latitude: GUARDED,
    longitude: GUARDED,
    emergencyContactName: OPEN,
    emergencyContactPhone: OPEN,
    npiNumber: VERIFIED_HARD,
    additionalLicenseStates: VERIFIED_HARD,
    yearsOfExperience: VERIFIED_SOFT,
    primaryLicenseType: VERIFIED_HARD,
    professionalSummary: OPEN,
    emr: OPEN,
    emrOther: OPEN,
    profilePhotoUrl: OPEN,
    specialization: VERIFIED_SOFT,
    licenseNumber: VERIFIED_HARD,
    licenseState: VERIFIED_HARD,
    workArea: GUARDED,
    doesHomeVisits: OPEN,
    ratePerVisit: OPEN,
    attemptedVisitRate: OPEN,
    evaluationRate: OPEN,
    travelFee: OPEN,
    yearsInHomeHealth: VERIFIED_SOFT,
    availableFrom: OPEN,
    caseloadCapacity: OPEN,

    id: LOCKED,
    userId: LOCKED,
    approvalStatus: LOCKED,
    approvedBy: LOCKED,
    approvedAt: LOCKED,
    rejectionReason: LOCKED,
    pendingReviewAt: LOCKED,
    reviewStartedAt: LOCKED,
    onboardingStep: LOCKED,
    onboardingComplete: LOCKED,
    hipaaAttested: LOCKED,
    hipaaAttestedAt: LOCKED,
    licenseVerified: LOCKED,
    insuranceVerified: LOCKED,
    backgroundCheckConsent: LOCKED,
    backgroundCheckSignature: LOCKED,
    backgroundCheckDate: LOCKED,
    backgroundCheckStatus: LOCKED,
    stripeAccountId: LOCKED,
    stripeBusinessStructure: LOCKED,
    stripeOnboardingComplete: LOCKED,
    planTier: LOCKED,
    createdAt: LOCKED,
    updatedAt: LOCKED,
};

export const CUSTOMER_FIELD_POLICY = {
    fullName: VERIFIED_HARD,
    agencyName: VERIFIED_HARD,
    phone: OPEN,
    smsOptIn: OPEN,
    location: GUARDED,
    dbaName: VERIFIED_SOFT,
    ein: VERIFIED_HARD,
    billingEmail: OPEN,
    addressLine1: GUARDED,
    addressLine2: GUARDED,
    city: GUARDED,
    state: GUARDED,
    zipCode: GUARDED,
    dateOfBirth: VERIFIED_HARD,
    primaryDiagnosis: VERIFIED_SOFT,
    referringProviderName: VERIFIED_SOFT,

    id: LOCKED,
    userId: LOCKED,
    customerType: LOCKED,
    approvalStatus: LOCKED,
    approvedBy: LOCKED,
    approvedAt: LOCKED,
    rejectionReason: LOCKED,
    pendingReviewAt: LOCKED,
    reviewStartedAt: LOCKED,
    onboardingStep: LOCKED,
    onboardingComplete: LOCKED,
    stripeCustomerId: LOCKED,
    stripeAccountId: LOCKED,
    stripeBusinessStructure: LOCKED,
    stripeOnboardingComplete: LOCKED,
    createdAt: LOCKED,
    updatedAt: LOCKED,
};

export const TIER_AVAILABILITY = {
    [APPROVAL_STATUS.PENDING]: { allow: [OPEN, GUARDED, VERIFIED_SOFT, VERIFIED_HARD], reReview: [] },
    [APPROVAL_STATUS.REJECTED]: { allow: [OPEN, GUARDED, VERIFIED_SOFT, VERIFIED_HARD], reReview: [] },
    [APPROVAL_STATUS.REVIEW]: { allow: [OPEN, GUARDED, VERIFIED_SOFT, VERIFIED_HARD], reReview: [] },
    [APPROVAL_STATUS.APPROVED]: { allow: [OPEN, GUARDED], reReview: [VERIFIED_SOFT, VERIFIED_HARD] },
};

export const partitionByPolicy = (data, policy, approvalStatus) => {
    const availability = TIER_AVAILABILITY[approvalStatus] ?? TIER_AVAILABILITY[APPROVAL_STATUS.REVIEW];

    const writable = {};
    const reReviewTiers = new Set();
    const locked = [];
    const blocked = [];
    const unknown = [];

    for (const [field, value] of Object.entries(data)) {
        if (value === undefined) continue;

        const tier = policy[field];
        if (!tier) { unknown.push(field); continue; }
        if (tier === LOCKED) { locked.push(field); continue; }

        if (availability.allow.includes(tier) || availability.reReview.includes(tier)) {
            writable[field] = value;
            if (availability.reReview.includes(tier)) reReviewTiers.add(tier);
        } else {
            blocked.push(field);
        }
    }

    return { writable, reReviewTiers, locked, blocked, unknown };
};
