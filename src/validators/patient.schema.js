import { z } from "zod";

export const createPatientSchema = z.object({
    fullName: z.string().min(2, "Full name must be at least 2 characters").max(255),
    dateOfBirth: z.string().date("Date of birth must be a valid date (YYYY-MM-DD)"),
    certificationStart: z.string().date("Certification start must be a valid date (YYYY-MM-DD)"),
    certificationEnd: z.string().date("Certification end must be a valid date (YYYY-MM-DD)"),
    gender: z.enum(["male", "female", "other"]).optional().nullable(),
    email: z.email("Invalid email address").optional().or(z.literal("")),
    phone: z.string().regex(/^\+1\d{10}$/, "Phone must be in format +1XXXXXXXXXX").optional().or(z.literal("")),
    addressLine1: z.string().min(1, "Address is required").max(255),
    addressLine2: z.string().max(255).optional().or(z.literal("")),
    city: z.string().min(1, "City is required").max(100),
    state: z.string().min(1, "State is required").max(50),
    zipCode: z.string().min(1, "Zip code is required").max(10),
    latitude: z.number().min(-90).max(90).optional(),
    longitude: z.number().min(-180).max(180).optional(),
}).refine((data) => data.certificationEnd >= data.certificationStart, {
    message: "Certification end date must be on or after the start date",
    path: ["certificationEnd"],
});

export const updatePatientSchema = z.object({
    fullName: z.string().min(2).max(255).optional(),
    dateOfBirth: z.string().date("Date of birth must be a valid date (YYYY-MM-DD)").optional(),
    certificationStart: z.string().date("Certification start must be a valid date (YYYY-MM-DD)").optional(),
    certificationEnd: z.string().date("Certification end must be a valid date (YYYY-MM-DD)").optional(),
    gender: z.enum(["male", "female", "other"]).optional().nullable(),
    email: z.email("Invalid email address").optional().or(z.literal("")),
    phone: z.string().regex(/^\+1\d{10}$/, "Phone must be in format +1XXXXXXXXXX").optional().or(z.literal("")),
    addressLine1: z.string().max(255).optional().or(z.literal("")),
    addressLine2: z.string().max(255).optional().or(z.literal("")),
    city: z.string().max(100).optional().or(z.literal("")),
    state: z.string().max(50).optional().or(z.literal("")),
    zipCode: z.string().max(10).optional().or(z.literal("")),
    latitude: z.number().min(-90).max(90).optional().nullable(),
    longitude: z.number().min(-180).max(180).optional().nullable(),
}).refine(
    (data) => data.certificationStart === undefined || data.certificationEnd === undefined || data.certificationEnd >= data.certificationStart,
    {
        message: "Certification end date must be on or after the start date",
        path: ["certificationEnd"],
    }
);