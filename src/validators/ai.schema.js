import { z } from "zod";
import { AI_AUDIENCES, AI_CONFIG, LEAD_ROLES } from "../config/ai.js";

const content = (max, label) =>
    z.string().trim().min(1, "Message cannot be empty").max(max, `${label} must be ${max} characters or less`);

const message = z.discriminatedUnion("role", [
    z.object({
        role: z.literal("user"),
        content: content(AI_CONFIG.maxInputChars, "Your message"),
    }),
    z.object({
        role: z.literal("assistant"),
        content: content(AI_CONFIG.maxAssistantChars, "Assistant message"),
    }),
]);

export const chatSchema = z.object({
    sessionId: z.string().uuid("Invalid session ID").optional(),
    audience: z.enum(AI_AUDIENCES).optional(),
    messages: z
        .array(message)
        .min(1, "At least one message is required")
        .max(AI_CONFIG.maxHistoryMessages, `Send ${AI_CONFIG.maxHistoryMessages} messages or fewer`)
        .refine((messages) => messages.at(-1)?.role === "user", {
            message: "The last message must be from the user",
        }),
});

const optionalText = (max, label) =>
    z
        .string()
        .trim()
        .max(max, `${label} must be ${max} characters or less`)
        .optional()
        .transform((value) => value || undefined);

export const leadSchema = z.object({
    role: z.enum(Object.keys(LEAD_ROLES), { message: "Please choose which best describes you" }),
    name: z.string().trim().min(1, "Please enter your name").max(80, "Name must be 80 characters or less"),
    email: z.string().trim().email("Please enter a valid email address").max(254),
    phone: optionalText(30, "Phone number"),
    context: optionalText(300, "Message"),
});
