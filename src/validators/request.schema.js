import { z } from "zod";

const preferredDateField = z.string()
    .regex(
        /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/,
        "Preferred date must be a valid date"
    )
    .refine(
        (val) => new Date(val).getTime() >= Date.now() - 24 * 60 * 60 * 1000,
        "Preferred date cannot be in the past"
    );

export const createRequestSchema = z.object({
    serviceType: z.string().trim().min(1, "Service type is required").max(100),
    description: z.string().trim().min(10, "Description must be at least 10 characters"),
    preferredDate: preferredDateField,
    location: z.string().trim().min(1, "Location is required"),
    latitude: z.number({ coerce: true }),
    longitude: z.number({ coerce: true }),
    patientId: z.string().uuid().optional().nullable(),
    visitType: z.string().trim().min(1).max(100).optional().nullable(),
    visitTypeId: z.string().uuid().optional().nullable(),
    emr: z.string().trim().min(1, "EMR system is required").max(100),
    specialInstructions: z.string().trim().max(1000).optional().nullable(),
    visitsPerWeek: z.number({ coerce: true }).int().min(1).max(7).optional().nullable(),
    numberOfWeeks: z.number({ coerce: true }).int().min(1).max(12).optional().nullable(),
    requestType: z.enum(["PUBLIC", "DIRECT"]).optional().default("PUBLIC"),
    targetTherapistId: z.string().uuid().optional().nullable(),
}).refine(
    (data) => Boolean(data.visitTypeId) || Boolean(data.visitType),
    { message: "Visit type is required", path: ["visitTypeId"] }
).refine(
    (data) => data.requestType !== "DIRECT" || Boolean(data.targetTherapistId),
    { message: "targetTherapistId is required for direct requests", path: ["targetTherapistId"] }
);

export const updateRequestSchema = z.object({
    serviceType: z.string().trim().min(1).max(100).optional(),
    description: z.string().trim().min(10, "Description must be at least 10 characters").optional(),
    preferredDate: preferredDateField.optional(),
    location: z.string().trim().min(1).optional(),
    latitude: z.number({ coerce: true }).optional(),
    longitude: z.number({ coerce: true }).optional(),
    visitType: z.string().trim().min(1).max(100).optional().nullable(),
    visitTypeId: z.string().uuid().optional().nullable(),
    emr: z.string().trim().min(1).max(100).optional(),
    specialInstructions: z.string().trim().max(1000).optional().nullable(),
    visitsPerWeek: z.number({ coerce: true }).int().min(1).max(7).optional().nullable(),
    numberOfWeeks: z.number({ coerce: true }).int().min(1).max(12).optional().nullable(),
});
