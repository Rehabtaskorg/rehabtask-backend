import { z } from "zod";

export const sendMessageSchema = z.object({
    content: z
        .string()
        .trim()
        .min(1, "Message cannot be empty")
        .max(2000, "Message too long (max 2000 characters)"),

    contextType: z.enum(["offer", "booking"], {
        errorMap: () => ({ message: "Invalid context type" }),
    }),

    contextId: z
        .uuid("Invalid context ID format"),
});

export const getMessagesSchema = {
    params: z.object({
        contextType: z.enum(["offer", "booking"], {
            errorMap: () => ({ message: "Invalid context type" }),
        }),
        contextId: z.uuid("Invalid context ID format"),
    }),
    query: z.object({
        limit: z
            .string()
            .optional()
            .default("50")
            .transform((val) => parseInt(val))
            .refine((val) => val >= 1 && val <= 100, "Limit must be between 1 and 100"),
        cursor: z.uuid().optional(),
        order: z.enum(["asc", "desc"]).optional().default("desc"),
    }),
};

export const markAsReadSchema = {
    params: z.object({
        contextType: z.enum(["offer", "booking"], {
            errorMap: () => ({ message: "Invalid context type" }),
        }),
        contextId: z.uuid("Invalid context ID format"),
    }),
};