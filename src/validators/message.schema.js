import { z } from "zod";

const contextTypeEnum = z.enum(["offer", "booking", "direct"], {
    errorMap: () => ({ message: "Invalid context type" }),
});

export const sendMessageSchema = z.object({
    content: z
        .string()
        .trim()
        .min(1, "Message cannot be empty")
        .max(2000, "Message too long (max 2000 characters)"),

    contextType: contextTypeEnum,

    contextId: z
        .uuid("Invalid context ID format"),

    replyToId: z
        .uuid("Invalid reply message ID format")
        .optional(),
});

export const sendDirectMessageSchema = z.object({
    recipientId: z.uuid("Invalid recipient ID format"),
    content: z
        .string()
        .trim()
        .min(1, "Message cannot be empty")
        .max(2000, "Message too long (max 2000 characters)"),
});

export const getMessagesSchema = {
    params: z.object({
        contextType: contextTypeEnum,
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
        contextType: contextTypeEnum,
        contextId: z.uuid("Invalid context ID format"),
    }),
};

export const getContextSchema = {
    params: z.object({
        contextType: contextTypeEnum,
        contextId: z.uuid("Invalid context ID format"),
    }),
};