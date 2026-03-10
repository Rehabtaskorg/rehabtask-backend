import { z } from "zod";

const VALID_PERMISSIONS = [
    "users",
    "therapists",
    "disputes",
    "bookings",
    "payments",
    "subscriptions",
    "faqs",
    "notifications",
    "commission",
];

// ── User Management ──────────────────────────────────────────────────────────

export const listUsersQuerySchema = z.object({
    role: z.enum(["customer", "therapist", "admin", "sub_admin"]).optional(),
    isActive: z.enum(["true", "false"]).optional(),
    search: z.string().max(200).optional(),
    page: z
        .string()
        .transform(Number)
        .pipe(z.number().int().min(1))
        .optional()
        .default("1"),
    limit: z
        .string()
        .transform(Number)
        .pipe(z.number().int().min(1).max(100))
        .optional()
        .default("20"),
});

export const userIdParamSchema = z.object({
    userId: z.uuid("Invalid user ID"),
});

export const updateUserSchema = z.object({
    email: z.email("Invalid email").optional(),
    fullName: z.string().min(2).max(100).optional(),
    phone: z.string().regex(/^\+1\d{10}$/, "Invalid phone format. Use +1XXXXXXXXXX").optional(),
    customerType: z.enum(["individual", "agency"]).optional(),
    agencyName: z.string().max(100).optional().nullable(),
    primaryLicenseType: z.string().max(50).optional(),
    bio: z.string().max(1000).optional().nullable(),
}).refine(data => Object.keys(data).length > 0, { message: "At least one field must be provided" });

// ── Therapist Management ─────────────────────────────────────────────────────

export const listTherapistsQuerySchema = z.object({
    approvalStatus: z.enum(["review", "pending", "approved", "rejected"]).optional(),
    search: z.string().max(200).optional(),
    page: z
        .string()
        .transform(Number)
        .pipe(z.number().int().min(1))
        .optional()
        .default("1"),
    limit: z
        .string()
        .transform(Number)
        .pipe(z.number().int().min(1).max(100))
        .optional()
        .default("20"),
});

export const therapistUserIdParamSchema = z.object({
    therapistUserId: z.uuid("Invalid therapist user ID"),
});

export const therapistDocumentParamSchema = z.object({
    therapistUserId: z.uuid("Invalid therapist user ID"),
    documentId: z.uuid("Invalid document ID"),
});

export const rejectTherapistSchema = z.object({
    reason: z
        .string()
        .min(10, "Rejection reason must be at least 10 characters")
        .max(2000, "Rejection reason must be 2000 characters or less"),
});

// ── Dispute Management ───────────────────────────────────────────────────────

export const adminListDisputesQuerySchema = z.object({
    status: z.enum(["open", "under_review", "resolved", "closed"]).optional(),
    assignedAdminId: z.uuid().optional(),
    unassigned: z.enum(["true", "false"]).optional(),
    page: z
        .string()
        .transform(Number)
        .pipe(z.number().int().min(1))
        .optional()
        .default("1"),
    limit: z
        .string()
        .transform(Number)
        .pipe(z.number().int().min(1).max(100))
        .optional()
        .default("20"),
});

export const disputeIdParamSchema = z.object({
    disputeId: z.uuid("Invalid dispute ID"),
});

export const assignDisputeSchema = z.object({
    assignedAdminId: z.uuid("Invalid admin user ID"),
});

export const adminUpdateDisputeSchema = z.object({
    status: z.enum(["open", "under_review", "resolved", "closed"]).optional(),
    resolution: z.string().max(5000).optional(),
    title: z.string().max(255).optional(),
    expectedUpdatedAt: z.string().datetime({ offset: true }).optional(),
});

// ── Booking Management ───────────────────────────────────────────────────────

export const adminListBookingsQuerySchema = z.object({
    status: z
        .enum([
            "pending",
            "confirmed",
            "in_progress",
            "completed",
            "cancelled",
            "reschedule_requested",
        ])
        .optional(),
    page: z
        .string()
        .transform(Number)
        .pipe(z.number().int().min(1))
        .optional()
        .default("1"),
    limit: z
        .string()
        .transform(Number)
        .pipe(z.number().int().min(1).max(100))
        .optional()
        .default("20"),
});

export const bookingIdParamSchema = z.object({
    bookingId: z.uuid("Invalid booking ID"),
});

export const adminCancelBookingSchema = z.object({
    reason: z.string().min(5).max(500).optional(),
});

// ── Subscription Management ──────────────────────────────────────────────────

export const adminListSubscriptionsQuerySchema = z.object({
    status: z.enum(["active", "inactive", "cancelled", "past_due"]).optional(),
    planType: z.enum(["free", "premium"]).optional(),
    page: z
        .string()
        .transform(Number)
        .pipe(z.number().int().min(1))
        .optional()
        .default("1"),
    limit: z
        .string()
        .transform(Number)
        .pipe(z.number().int().min(1).max(100))
        .optional()
        .default("20"),
});

export const subscriptionIdParamSchema = z.object({
    subscriptionId: z.uuid("Invalid subscription ID"),
});

// ── Payment Management ───────────────────────────────────────────────────────

export const adminListPaymentsQuerySchema = z.object({
    status: z
        .enum(["intent_created", "escrowed", "released", "refunded", "failed"])
        .optional(),
    page: z
        .string()
        .transform(Number)
        .pipe(z.number().int().min(1))
        .optional()
        .default("1"),
    limit: z
        .string()
        .transform(Number)
        .pipe(z.number().int().min(1).max(100))
        .optional()
        .default("20"),
});

export const paymentIdParamSchema = z.object({
    paymentId: z.uuid("Invalid payment ID"),
});

export const adminRefundPaymentSchema = z.object({
    reason: z
        .string()
        .min(5, "Reason must be at least 5 characters")
        .max(500),
});

// ── Sub-Admin Management ─────────────────────────────────────────────────────

export const createSubAdminSchema = z.object({
    email: z.email("Invalid email address"),
    permissions: z
        .array(z.enum(VALID_PERMISSIONS))
        .min(1, "At least one permission is required"),
});

export const promoteToSubAdminSchema = z.object({
    permissions: z
        .array(z.enum(VALID_PERMISSIONS))
        .min(1, "At least one permission is required"),
});

export const updateSubAdminPermissionsSchema = z.object({
    permissions: z
        .array(z.enum(VALID_PERMISSIONS))
        .min(1, "At least one permission is required"),
});

// ── Commission Management ────────────────────────────────────────────────────

export const setCommissionRateSchema = z.object({
    rate: z
        .number()
        .min(0, "Rate must be at least 0")
        .max(1, "Rate must not exceed 1 (100%)"),
    effectiveFrom: z.string().datetime().optional(),
});

// ── Notification Broadcast ────────────────────────────────────────────────────

export const broadcastNotificationSchema = z.object({
    role: z.enum(["all", "customer", "therapist", "admin", "sub_admin"]),
    type: z.string().min(1).max(100),
    title: z.string().min(1).max(255),
    message: z.string().min(1).max(5000),
    metadata: z.record(z.unknown()).optional(),
});