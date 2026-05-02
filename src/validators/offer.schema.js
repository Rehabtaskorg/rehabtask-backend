import { z } from "zod";

const isoDatetime = z.string()
    .regex(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})$/,
        "Must be a valid ISO 8601 datetime"
    );

// Visit plan override fields (all optional/nullable).
// When set, these are the therapist's counter-proposal to the customer's plan.
// Null/undefined = "therapist accepts customer's plan as-is" — the fallback
// chain in src/utils/visitPlan.js walks through to the request values.
// Ranges match request.schema.js exactly so the two stay comparable.
const visitPlanOverride = {
    visitType: z.string().trim().min(1).max(100).optional().nullable(),
    visitsPerWeek: z.number({ coerce: true }).int().min(1).max(7).optional().nullable(),
    numberOfWeeks: z.number({ coerce: true }).int().min(1).max(12).optional().nullable(),
};

// Attempted visit rate on an offer: optional, nullable. Zero is treated as null
// (not configured) — a $0 attempted rate is indistinguishable from "no charge".
const attemptedVisitRateField = z.number({ invalid_type_error: "Attempted visit rate must be a number" })
    .min(0, "Attempted visit rate must be 0 or greater")
    .max(10000, "Attempted visit rate must be $10,000 or less")
    .multipleOf(0.01, "Attempted visit rate must have at most 2 decimal places")
    .nullable()
    .optional()
    .transform(val => (val === 0 ? null : val));

const attemptedRateCapRefine = (data) => {
    if (data.attemptedVisitRate == null) return true;
    return data.attemptedVisitRate <= data.rate;
};
const attemptedRateCapError = {
    message: "Attempted visit rate cannot be greater than the session rate",
    path: ["attemptedVisitRate"],
};

export const createOfferSchema = z.object({
    requestId: z.uuid("Invalid request ID"),
    rate: z.number({ invalid_type_error: "Rate must be a number" })
        .positive("Rate must be a positive number")
        .multipleOf(0.01, "Rate must have at most 2 decimal places"),
    sessionType: z.enum(["in_person", "virtual"], {
        errorMap: () => ({ message: "Session type must be 'in_person' or 'virtual'" }),
    }),
    proposedDate:
        isoDatetime
            .refine((val) => new Date(val) > new Date(), {
                message: "Proposed date must be in the future",
            }),
    description: z.string()
        .min(10, "Description must be at least 10 characters")
        .max(1000, "Description must not exceed 1000 characters"),
    visitTypeId: z.string().uuid().optional().nullable(),
    attemptedVisitRate: attemptedVisitRateField,
    ...visitPlanOverride,
}).refine(attemptedRateCapRefine, attemptedRateCapError);

export const reviseOfferSchema = z.object({
    rate: z.number({ invalid_type_error: "Rate must be a number" })
        .positive("Rate must be a positive number")
        .multipleOf(0.01, "Rate must have at most 2 decimal places"),
    sessionType: z.enum(["in_person", "virtual"]),
    proposedDate:
        isoDatetime
            .refine((val) => new Date(val) > new Date(), {
                message: "Proposed date must be in the future",
            }),
    description: z.string().min(10).max(1000),
    visitTypeId: z.string().uuid().optional().nullable(),
    attemptedVisitRate: attemptedVisitRateField,
    ...visitPlanOverride,
}).refine(attemptedRateCapRefine, attemptedRateCapError);

export const requestChangeSchema = z.object({
    note: z.string()
        .min(10, "Please describe the changes you'd like in at least 10 characters")
        .max(500, "Note must not exceed 500 characters"),
});

export const rescheduleSchema = z.object({
    newDate:
        isoDatetime
            .refine((val) => new Date(val) > new Date(), {
                message: "New date must be in the future",
            }),
});

export const respondToRescheduleSchema = z.object({
    accept: z.boolean({ required_error: "accept must be true or false" }),
    reason: z.string().max(500, "Reason must not exceed 500 characters").optional(),
});