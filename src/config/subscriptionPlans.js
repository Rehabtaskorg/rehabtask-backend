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

/**
 * Reverse lookup: Stripe Price ID → { planType, billingInterval }
 * Used by webhooks to detect plan changes from Stripe events.
 */
export const getPlanFromPriceId = (priceId) => {
    const plans = ["standard", "premium"];
    const intervals = ["monthly", "annual"];

    for (const plan of plans) {
        for (const interval of intervals) {
            const key = `STRIPE_PRICE_${plan.toUpperCase()}_${interval.toUpperCase()}`;
            if (process.env[key] === priceId) {
                return { planType: plan, billingInterval: interval };
            }
        }
    }
    return null;
};