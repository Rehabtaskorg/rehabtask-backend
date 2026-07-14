import { z } from "zod";

export const createCheckoutSchema = z.object({
    planType: z.enum(["pro", "enterprise", "unlimited"], {
        required_error: "Plan type is required",
        invalid_type_error: "Plan type must be 'pro', 'enterprise', or 'unlimited'",
    }),
});