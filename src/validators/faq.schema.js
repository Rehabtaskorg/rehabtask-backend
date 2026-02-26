import { z } from "zod";

export const createFaqSchema = z.object({
    question: z
        .string()
        .min(10, "Question must be at least 10 characters")
        .max(500, "Question must be 500 characters or less"),
    answer: z
        .string()
        .min(10, "Answer must be at least 10 characters")
        .max(5000, "Answer must be 5000 characters or less"),
    category: z
        .string()
        .min(1, "Category is required")
        .max(100, "Category must be 100 characters or less"),
    sortOrder: z.number().int().min(0, "Sort order must be 0 or greater").optional().default(0),
    isActive: z.boolean().optional().default(true),
});

export const updateFaqSchema = z.object({
    question: z
        .string()
        .min(10, "Question must be at least 10 characters")
        .max(500, "Question must be 500 characters or less")
        .optional(),
    answer: z
        .string()
        .min(10, "Answer must be at least 10 characters")
        .max(5000, "Answer must be 5000 characters or less")
        .optional(),
    category: z
        .string()
        .min(1, "Category is required")
        .max(100, "Category must be 100 characters or less")
        .optional(),
    sortOrder: z.number().int().min(0, "Sort order must be 0 or greater").optional(),
    isActive: z.boolean().optional(),
});

export const faqIdParamSchema = z.object({
    faqId: z.string().uuid("Invalid FAQ ID"),
});