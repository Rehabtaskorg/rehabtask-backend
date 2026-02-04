import { z } from "zod";

/**
 * Password validation rules
 * - Minimum 8 characters
 * - At least one uppercase letter
 * - At least one lowercase letter
 * - At least one number
 * - At least one special character
 */
const passwordSchema = z
    .string()
    .min(8, "Password must be atleast 8 characters")
    .regex(/[A-Z]/, "Password must contain atleast one uppercase letter")
    .regex(/[a-z]/, "Password must contain atleast one lowercase letter")
    .regex(/[0-9]/, "Password must contain atleast one number")
    .regex(/[^A-Za-z0-9]/, "Password must contain atleast one special character");

/**
 * Email validation
 */
const emailSchema = z
    .email("Invalid email address")
    .toLowerCase()
    .trim();

/**
 * Phone number validation (international format)
 */
const phoneSchema = z
    .string()
    .regex(/^\+?[1-9]\d{1,14}$/, "Invalid phone number format. Use international format (e.g, +1234567890)")
    .trim()

/**
 * Full name validation
 */
const fullNameSchema = z
    .string()
    .min(2, "Name must be atleast 2 characters")
    .max(255, "Name must not exceed 255 characters")
    .regex(/^[a-zA-Z\s'.-]+$/, 'Name can only contain letters, spaces, hyphens, and apostrophes')
    .trim();

/**
 * License number validation
 */
const licenseNumberSchema = z
    .string()
    .min(3, 'License number must be at least 3 characters')
    .max(100, 'License number must not exceed 100 characters')
    .trim();

/**
 * Customer type enum
 */
const customerTypeSchema = z.enum(["individual", "agency"], {
    errorMap: () => ({ message: "Customer type must be individual or agency" }),
});

/**
 * Register customer schema
 */
export const registerCustomerSchema = z.object({
    email: emailSchema,
    password: passwordSchema,
    fullName: fullNameSchema,
    phone: phoneSchema,
    location: z.string().trim().optional(),
    customerType: customerTypeSchema,
    agencyName: z.string().min(2).max(255).trim().optional(),
    recaptchaToken: z.string().optional(),
}).refine(
    (data) => {
        if (data.customerType === "agency") {
            return !!data.agencyName && data.agencyName.length >= 2;
        }
        return true;
    }, {
    error: "Agency name is required for agency accounts",
    path: ["agencyName"],
}
);

/**
 * Register therapist schema
 */
export const registerTherapistSchema = z.object({
    email: emailSchema,
    password: passwordSchema,
    fullName: fullNameSchema,
    phone: phoneSchema,
    recaptchaToken: z.string().optional()
});

/**
 * Login schema
 */
export const loginSchema = z.object({
    email: emailSchema,
    password: z.string().min(1, "Password is required"),
    recaptchaToken: z.string().optional(),
});

/**
 * Request password reset schema
 */
export const requestPasswordResetSchema = z.object({
    email: emailSchema,
    recaptchaToken: z.string().optional(),
});

/**
 * Reset password schema
 */
export const resetPasswordSchema = z.object({
    password: passwordSchema,
    confirmPassword: z.string(),
}).refine((data) => data.password === data.confirmPassword, {
    error: "Passwords do not match",
    path: ["confirmPassword"],
});

/**
 * Change password schema
 */
export const changePasswordSchema = z.object({
    currentPassword: z.string().min(1, "Current password is required"),
    newPassword: passwordSchema,
    confirmNewPassword: z.string(),
}).refine((data) => data.newPassword === data.confirmNewPassword, {
    error: "Passwords do not match",
    path: ["confirmNewPassword"],
}).refine((data) => data.currentPassword !== data.newPassword, {
    error: "New password must be different from current password",
    path: ["newPassword"]
});

/**
 * Resend verification email schema
 */
export const resendVerificationSchema = z.object({
    email: emailSchema,
    recaptchaToken: z.string().optional(),
});

/**
 * Refresh token schema
 */
export const refreshTokenSchema = z.object({
    refreshToken: z.string().min(1, "Refresh token is required"),
});