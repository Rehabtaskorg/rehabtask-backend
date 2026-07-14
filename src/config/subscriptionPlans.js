import { PLAN_TYPES } from "../utils/constants.js";

export const PLAN_CONFIG = {
    [PLAN_TYPES.FREE]:       { visitLimit: 10,   jobPostingLimit: 5,    rank: 0 },
    [PLAN_TYPES.PRO]:        { visitLimit: 150,  jobPostingLimit: null, rank: 1 },
    [PLAN_TYPES.ENTERPRISE]: { visitLimit: 500,  jobPostingLimit: null, rank: 2 },
    [PLAN_TYPES.UNLIMITED]:  { visitLimit: null, jobPostingLimit: null, rank: 3 },
};

export const TRIAL_DURATION_DAYS = 30;
export const GRACE_PERIOD_DAYS = 3;

export const getStripePriceId = (planType) => {
    const key = `STRIPE_PRICE_${planType.toUpperCase()}_MONTHLY`;
    const priceId = process.env[key];
    if (!priceId) throw new Error(`Missing Stripe price env var: ${key}`);
    return priceId;
};

export const getPlanFromPriceId = (priceId) => {
    for (const planType of [PLAN_TYPES.PRO, PLAN_TYPES.ENTERPRISE, PLAN_TYPES.UNLIMITED]) {
        const key = `STRIPE_PRICE_${planType.toUpperCase()}_MONTHLY`;
        if (process.env[key] === priceId) return { planType, billingInterval: "monthly" };
    }
    return null;
};
