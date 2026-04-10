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
 */

/**
 * Canonical mapping from customer-facing service type to therapist discipline.
 * The customer's wizard uses "Physical Therapy" / "Occupational Therapy" /
 * "Speech Language Pathology (SLP)"; the visit_types catalog and therapist
 * licenses use "Physical Therapist" / "Occupational Therapist" / "Speech
 * Therapist". This is the one place that bridge lives.
 *
 */
export const SERVICE_TYPE_TO_DISCIPLINE = Object.freeze({
    "Physical Therapy": "Physical Therapist",
    "Occupational Therapy": "Occupational Therapist",
    "Speech Language Pathology (SLP)": "Speech Therapist",
});

/**
 * Resolve the discipline for a given customer-facing service type.
 * Returns null if the service type is unrecognized — callers should treat
 * that as "show nothing / invalid request".
 *
 * @param {string|null|undefined} serviceType
 * @returns {string|null}
 */
export const disciplineForServiceType = (serviceType) => {
    if (!serviceType) return null;
    return SERVICE_TYPE_TO_DISCIPLINE[serviceType] ?? null;
};

/**
 * Pull a visit type value (name or code) from a row at a single layer,
 * preferring the FK-loaded relation and falling back to the legacy string.
 * Returns undefined when neither source has anything — lets ?? chain cleanly.
 *
 * @param {object|null|undefined} row
 * @param {"name"|"code"} field
 */
const visitTypeFieldFrom = (row, field) => {
    if (!row) return undefined;
    if (row.visitTypeRef && row.visitTypeRef[field] != null) return row.visitTypeRef[field];
    if (field === "name" && row.visitType != null && typeof row.visitType === "string") return row.visitType;
    return undefined;
};

const visitTypeIdFrom = (row) => {
    if (!row) return undefined;
    if (row.visitTypeId != null) return row.visitTypeId;
    if (row.visitTypeRef?.id != null) return row.visitTypeRef.id;
    return undefined;
};

/**
 * Resolve the effective visit plan from a booking/offer/request chain.
 *
 * Pass only the layers you have. For example:
 *   - At payment-intent time (post-migration):  { booking, offer, request }
 *   - At offer-accept time (before booking row exists): { offer, request }
 *   - Legacy booking with NULL override fields: the fallback walks through offer→request
 *
 * @param {object} opts
 * @param {object} [opts.booking] - Booking row (may have legacy string or FK relation)
 * @param {object} [opts.offer]   - Offer row (may have legacy string or FK relation)
 * @param {object} [opts.request] - TherapyRequest row (may have legacy string or FK relation)
 * @returns {{
 *   visitType: string|null,
 *   visitTypeCode: string|null,
 *   visitTypeId: string|null,
 *   visitsPerWeek: number|null,
 *   numberOfWeeks: number|null
 * }}
 */
export const resolveVisitPlan = ({ booking, offer, request } = {}) => ({
    visitType:
        visitTypeFieldFrom(booking, "name") ??
        visitTypeFieldFrom(offer, "name") ??
        visitTypeFieldFrom(request, "name") ??
        null,
    visitTypeCode:
        visitTypeFieldFrom(booking, "code") ??
        visitTypeFieldFrom(offer, "code") ??
        visitTypeFieldFrom(request, "code") ??
        null,
    visitTypeId:
        visitTypeIdFrom(booking) ??
        visitTypeIdFrom(offer) ??
        visitTypeIdFrom(request) ??
        null,
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
