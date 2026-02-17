import { z } from "zod";

export const sendMessageSchema = z.object({
    content: z
        .string()
        .trim()
        .min(1, "Message cannot be empty")
        .max(2000, "Message too long (max 2000 characters)"),

    contextType: z.enum(["request", "offer", "booking"], {
        errorMap: () => ({ message: "Invalid context type" }),
    }),

    contextId: z
        .uuid("Invalid context ID format"),
});

export const getMessageSchema = z.object({
    params: z.object({
        contextType: z.enum(["request", "offer", "booking"]),
        contextId: z.uuid(),
    }),

    query: z.object({
        limit: z
            .string()
            .optional()
            .transform((val) => (val ? parseInt(val) : 50))
            .refine((val) => val >= 1 && val <= 100, "Limit must be between 1 and 100"),

        cursor: z.uuid().optional(),

        order: z.enum(["asc", "desc"]).optional().default("desc"),
    }).optional(),
});

export const markAsReadSchema = z.object({
    params: z.object({
        contextType: z.enum(["request", "offer", "booking"]),
        contextId: z.uuid(),
    }),
})