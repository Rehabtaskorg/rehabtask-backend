export const PLAN_CONFIG = {
    free: { requestLimit: 5, therapistLimit: 5, features: [], rank: 0 },
    standard: { requestLimit: 10, therapistLimit: 10, features: [], rank: 1 },
    premium: { requestLimit: null, therapistLimit: null, features: ["elite_filter", "coordinator"], rank: 2 },
};

export const TRIAL_DURATION_DAYS = 30;
export const GRACE_PERIOD_DAYS = 3;

/**
 * Resolve Stripe Price ID from plan type and billing interval.
 * Price IDs are stored as environment variables.
 */
export const getStripePriceId = (planType, billingInterval) => {
    const key = `STRIPE_PRICE_${planType.toUpperCase()}_${billingInterval.toUpperCase()}`;
    const priceId = process.env[key];
    if (!priceId) {
        throw new Error(`Missing Stripe price env var: ${key}`);
    }
    return priceId;
};