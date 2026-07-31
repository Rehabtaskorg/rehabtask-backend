import { z } from "zod";

const phoneSchema = z
    .string()
    .regex(/^\+1\d{10}$/, "Phone must be in format +1XXXXXXXXXX");

export const updateCustomerProfileSchema = z.object({
    agencyName: z
        .string()
        .min(2, "Agency name must be at least 2 characters")
        .max(255, "Agency name must be 255 characters or less")
        .optional(),
    phone: phoneSchema.optional(),
    smsOptIn: z.boolean().optional(),
});
