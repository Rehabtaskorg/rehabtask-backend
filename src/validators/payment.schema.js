import { z } from "zod";

export const createPaymentIntentSchema = z.object({
    bookingId: z.uuid("Invalid booking ID"),
    paymentMethodId: z.string()
        .regex(/^pm_/, "Payment method ID must start with 'pm_'")
        .optional(),
});

export const refundSchema = z.object({
    bookingId: z.uuid("Invalid booking ID"),
    reason: z.string()
        .min(1, "Reason is required")
        .max(500, "Reason must not exceed 500 characters"),
});

export const paymentMethodIdParamSchema = z.object({
    paymentMethodId: z.string()
        .regex(/^pm_/, "Payment method ID must start with 'pm_'"),
});