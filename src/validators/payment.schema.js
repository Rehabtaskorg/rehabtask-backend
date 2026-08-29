import { z } from "zod";
import { STRIPE_BUSINESS_STRUCTURE } from "../utils/constants.js";

export const createConnectAccountSchema = z.object({
    businessStructure: z.enum(
        [
            STRIPE_BUSINESS_STRUCTURE.INDIVIDUAL,
            STRIPE_BUSINESS_STRUCTURE.SOLE_PROPRIETORSHIP,
            STRIPE_BUSINESS_STRUCTURE.SINGLE_MEMBER_LLC,
            STRIPE_BUSINESS_STRUCTURE.MULTI_MEMBER_LLC,
            STRIPE_BUSINESS_STRUCTURE.PRIVATE_CORPORATION,
        ],
        "Select how your practice is registered"
    ),
});

export const createCustomerConnectAccountSchema = z.object({
    businessStructure: z.enum(
        [
            STRIPE_BUSINESS_STRUCTURE.INDIVIDUAL,
            STRIPE_BUSINESS_STRUCTURE.SOLE_PROPRIETORSHIP,
            STRIPE_BUSINESS_STRUCTURE.SINGLE_MEMBER_LLC,
            STRIPE_BUSINESS_STRUCTURE.MULTI_MEMBER_LLC,
            STRIPE_BUSINESS_STRUCTURE.PRIVATE_CORPORATION,
        ],
        "Select how your organization is registered"
    ),
});

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