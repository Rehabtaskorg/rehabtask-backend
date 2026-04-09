/**
 * Visit Plan resolver — single source of truth for the fallback chain.
 *
 * Precedence: booking > offer > request. A value set on a later layer
 * (e.g., booking) always wins over earlier layers. NULL/undefined on any
 * layer means "not overridden at this layer, look at the next one".
 *
 * This is the ONLY place the fallback logic should live. Every consumer
 * (payment service, session materialization, response shapers) must import
 * from here instead of hand-rolling the precedence inline.
 *
 */

/**
 * Resolve the effective visit plan from a booking/offer/request chain.
 *
 * Pass only the layers you have. For example:
 *   - At payment-intent time (post-migration):  { booking, offer, request }
 *   - At offer-accept time (before booking row exists): { offer, request }
 *   - Legacy booking with NULL columns: the fallback walks through offer→request
 *
 * @param {object} opts
 * @param {object} [opts.booking] - Booking row (may have NULL override fields)
 * @param {object} [opts.offer]   - Offer row (may have NULL override fields)
 * @param {object} [opts.request] - TherapyRequest row (source of customer's plan)
 * @returns {{visitType: string|null, visitsPerWeek: number|null, numberOfWeeks: number|null}}
 */
export const resolveVisitPlan = ({ booking, offer, request } = {}) => ({
    visitType:     booking?.visitType     ?? offer?.visitType     ?? request?.visitType     ?? null,
    visitsPerWeek: booking?.visitsPerWeek ?? offer?.visitsPerWeek ?? request?.visitsPerWeek ?? null,
    numberOfWeeks: booking?.numberOfWeeks ?? offer?.numberOfWeeks ?? request?.numberOfWeeks ?? null,
});

/**
 * Compute total sessions from a resolved visit plan.
 * Returns 1 (single-session booking) if either leg of the frequency is missing.
 *
 * @param {{visitsPerWeek: number|null, numberOfWeeks: number|null}} plan
 * @returns {number}
 */
export const computeTotalSessions = (plan) => {
    if (plan?.visitsPerWeek && plan?.numberOfWeeks) {
        return plan.visitsPerWeek * plan.numberOfWeeks;
    }
    return 1;
};