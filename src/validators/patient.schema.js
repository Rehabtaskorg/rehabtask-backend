import { z } from "zod";

export const createPatientSchema = z.object({
    fullName: z.string().min(2, "Full name must be at least 2 characters").max(255),
    email: z.email("Invalid email address").optional().or(z.literal("")),
    phone: z.string().regex(/^\+1\d{10}$/, "Phone must be in format +1XXXXXXXXXX").optional().or(z.literal("")),
    addressLine1: z.string().min(1, "Address is required").max(255),
    addressLine2: z.string().max(255).optional().or(z.literal("")),
    city: z.string().min(1, "City is required").max(100),
    state: z.string().min(1, "State is required").max(50),
    zipCode: z.string().min(1, "Zip code is required").max(10),
    latitude: z.number().min(-90).max(90).optional(),
    longitude: z.number().min(-180).max(180).optional(),
});

export const updatePatientSchema = z.object({
    fullName: z.string().min(2).max(255).optional(),
    email: z.email("Invalid email address").optional().or(z.literal("")),
    phone: z.string().regex(/^\+1\d{10}$/, "Phone must be in format +1XXXXXXXXXX").optional().or(z.literal("")),
    addressLine1: z.string().min(1).max(255).optional(),
    addressLine2: z.string().max(255).optional().or(z.literal("")),
    city: z.string().min(1).max(100).optional(),
    state: z.string().min(1).max(50).optional(),
    zipCode: z.string().min(1).max(10).optional(),
    latitude: z.number().min(-90).max(90).optional(),
    longitude: z.number().min(-180).max(180).optional(),
});
