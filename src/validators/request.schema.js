import { z } from "zod";

export const createRequestSchema = z.object({
    serviceType: z.string().trim().min(1, "Service type is required").max(100),
    description: z.string().trim().min(10, "Description must be at least 10 characters"),
    preferredDate: z.string().min(1, "Preferred date is required"),
    location: z.string().trim().min(1, "Location is required"),
    latitude: z.number({ coerce: true }),
    longitude: z.number({ coerce: true }),
    patientId: z.string().uuid().optional().nullable(),
    rate: z.number({ coerce: true }).positive("Rate must be a positive number"),
    visitType: z.string().trim().min(1, "Visit type is required").max(100),
    emr: z.string().trim().min(1, "EMR system is required").max(100),
});

export const updateRequestSchema = z.object({
    serviceType: z.string().trim().min(1).max(100).optional(),
    description: z.string().trim().min(10, "Description must be at least 10 characters").optional(),
    preferredDate: z.string().min(1).optional(),
    location: z.string().trim().min(1).optional(),
    latitude: z.number({ coerce: true }).optional(),
    longitude: z.number({ coerce: true }).optional(),
    rate: z.number({ coerce: true }).positive("Rate must be a positive number").optional(),
    visitType: z.string().trim().min(1).max(100).optional(),
    emr: z.string().trim().min(1).max(100).optional(),
});
