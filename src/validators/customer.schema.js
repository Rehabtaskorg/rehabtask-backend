import { z } from "zod";
import { US_STATE_CODES } from "../utils/constants.js";

const phoneSchema = z
    .string()
    .regex(/^\+1\d{10}$/, "Phone must be in format +1XXXXXXXXXX");

export const updateCustomerProfileSchema = z.object({
    fullName: z
        .string()
        .min(2, "Full name must be at least 2 characters")
        .max(255, "Full name must be 255 characters or less")
        .optional(),
    agencyName: z
        .string()
        .min(2, "Agency name must be at least 2 characters")
        .max(255, "Agency name must be 255 characters or less")
        .optional(),
    phone: phoneSchema.optional(),
    smsOptIn: z.boolean().optional(),
    location: z.string().max(255, "Location must be 255 characters or less").optional().nullable(),
    dbaName: z.string().max(255, "DBA name must be 255 characters or less").optional().nullable(),
    ein: z
        .string()
        .regex(/^\d{2}-\d{7}$/, "EIN must be in format XX-XXXXXXX")
        .optional()
        .nullable(),
    billingEmail: z
        .string()
        .email("Billing email must be a valid email address")
        .max(255, "Billing email must be 255 characters or less")
        .optional(),
    addressLine1: z.string().min(1, "Address is required").max(255).optional(),
    addressLine2: z.string().max(255).optional().nullable(),
    city: z.string().min(1, "City is required").max(100).optional(),
    state: z
        .string()
        .length(2, "State must be a 2-letter code")
        .refine((val) => US_STATE_CODES.includes(val.toUpperCase()), {
            message: "Please provide a valid US state",
        })
        .transform((val) => val.toUpperCase())
        .optional(),
    zipCode: z
        .string()
        .regex(/^\d{5}$/, "ZIP code must be exactly 5 digits")
        .optional(),
    dateOfBirth: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, "Date of birth must be in YYYY-MM-DD format")
        .refine((val) => {
            const date = new Date(val);
            const now = new Date();
            const age = now.getFullYear() - date.getFullYear();
            return !isNaN(date.getTime()) && age >= 18 && age <= 100;
        }, "Individual must be between 18 and 100 years old")
        .optional(),
    primaryDiagnosis: z.string().max(255, "Primary diagnosis must be 255 characters or less").optional().nullable(),
    referringProviderName: z.string().max(255, "Referring provider must be 255 characters or less").optional().nullable(),
}).passthrough();
