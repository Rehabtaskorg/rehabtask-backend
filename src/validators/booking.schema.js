import { z } from "zod";

export const cancellationRequestSchema = z.object({
    reason: z.string().min(1, "Reason is required").max(500),
});

export const cancellationRejectSchema = z.object({
    reason: z.string().min(1, "Rejection reason is required").max(500),
});

export const adminCancellationOverrideSchema = z.object({
    reason: z.string().max(500).optional(),
});
