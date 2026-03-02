import { z } from "zod";

export const createPatientSchema = z.object({
    fullName: z.string().min(2, "Full name must be at least 2 characters").max(255),
    email: z.email("Invalid email address"),
    phone: z.string().max(20).optional(),
});

export const updatePatientSchema = z.object({
    fullName: z.string().min(2).max(255).optional(),
    email: z.email("Invalid email address").optional(),
    phone: z.string().max(20).optional(),
})