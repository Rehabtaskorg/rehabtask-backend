import { z } from "zod";
import { AI_AUDIENCES, AI_CONFIG, LEAD_CATEGORIES, LEAD_ROLES } from "../config/ai.js";

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

const DISPOSABLE_EMAIL_DOMAINS = new Set([
    "mailinator.com",
    "guerrillamail.com",
    "10minutemail.com",
    "tempmail.com",
    "temp-mail.org",
    "throwawaymail.com",
    "yopmail.com",
    "trashmail.com",
    "sharklasers.com",
    "getnada.com",
    "dispostable.com",
    "fakeinbox.com",
    "maildrop.cc",
    "mailnesia.com",
    "example.com",
    "test.com",
]);

export const leadSchema = z.object({
    role: z.preprocess(
        (value) => value || undefined,
        z.enum(Object.keys(LEAD_ROLES)).optional()
    ),
    category: z.preprocess(
        (value) => value || undefined,
        z.enum(Object.keys(LEAD_CATEGORIES), { message: "Please choose one of the listed options" }).optional()
    ),
    name: z
        .string()
        .trim()
        .min(2, "Please enter your full name")
        .max(80, "Name must be 80 characters or less")
        .regex(/^[\p{L}\s'.-]+$/u, "Name can only contain letters, spaces, hyphens and apostrophes")
        .optional(),
    email: z
        .string()
        .trim()
        .toLowerCase()
        .email("Please enter a valid email address")
        .max(254)
        .refine((value) => !DISPOSABLE_EMAIL_DOMAINS.has(value.split("@")[1]), {
            message: "Please use a permanent email address we can reply to",
        })
        .optional(),
    recaptchaToken: z.string().optional(),
    recaptchaAction: z.string().optional(),
    phone: z
        .string()
        .trim()
        .regex(/^\+1\d{10}$/, "Invalid phone number format. Use +1XXXXXXXXXX")
        .optional()
        .or(z.literal("").transform(() => undefined)),
    context: z
        .string()
        .trim()
        .min(1, "Please tell us what you need help with")
        .max(300, "Message must be 300 characters or less"),
});
