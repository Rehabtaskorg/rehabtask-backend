import { z } from "zod";

export const updateCustomerProfileSchema = z.object({
    agencyName: z
        .string()
        .min(2, "Agency name must be at least 2 characters")
        .max(255, "Agency name must be 255 characters or less")
        .optional(),
});