import { z } from "zod";

export const createCheckoutSchema = z.object({
    planType: z.enum(["standard", "premium"], {
        required_error: "Plan type is required",
        invalid_type_error: "Plan type must be 'standard' or 'premium'",
    }),
    billingInterval: z.enum(["monthly", "annual"], {
        required_error: "Billing interval is required",
        invalid_type_error: "Billing interval must be 'monthly' or 'annual'",
    }),
});