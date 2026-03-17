import { z } from "zod";

export const createDisputeSchema = z.object({
    bookingId: z.uuid("Invalid booking ID").optional(),
    type: z.enum(["billing", "service_quality", "no_show", "communication", "other"], {
        errorMap: () => ({
            message:
                "Type must be 'billing', 'service_quality', 'no_show', 'communication', or 'other'",
        }),
    }),
    description: z
        .string()
        .min(20, "Description must be at least 20 characters")
        .max(5000, "Description must be 5000 characters or less"),
});

export const updateDisputeSchema = z.object({
    status: z.enum(["open", "under_review", "resolved", "closed"], {
        errorMap: () => ({
            message: "Status must be 'open', 'under_review', 'resolved', or 'closed'",
        }),
    }),
    resolution: z
        .string()
        .max(5000, "Resolution must be 5000 characters or less")
        .optional(),
});

export const listDisputesQuerySchema = z.object({
    status: z
        .enum(["open", "under_review", "resolved", "closed"], {
            errorMap: () => ({
                message: "Status must be 'open', 'under_review', 'resolved', or 'closed'",
            }),
        })
        .optional(),
    page: z
        .string()
        .transform((val) => parseInt(val, 10))
        .pipe(z.number().int().min(1))
        .optional()
        .default("1"),
    limit: z
        .string()
        .transform((val) => parseInt(val, 10))
        .pipe(z.number().int().min(1).max(50))
        .optional()
        .default("20"),
});