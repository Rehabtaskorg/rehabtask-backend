import { z } from "zod";
import { THERAPIST_VERIFICATION_FIELDS, APPROVAL_STATUS, CUSTOMER_TYPES } from "../utils/constants.js";
import { VALID_PERMISSIONS } from "../services/admin.subadmin.service.js";

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
    userId: z.string().min(1, "Invalid user ID"),
});

export const sendEmailSchema = z.object({
    to: z.email("Invalid email address"),
    subject: z.string().min(1, "Subject is required").max(200),
    message: z.string().min(1, "Message is required").max(5000),
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
    approvalStatus: z.enum(Object.values(APPROVAL_STATUS)).optional(),
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
    therapistUserId: z.string().min(1, "Invalid therapist user ID"),
});

export const therapistDocumentParamSchema = z.object({
    therapistUserId: z.string().min(1, "Invalid therapist user ID"),
    documentId: z.uuid("Invalid document ID"),
});

export const rejectTherapistSchema = z.object({
    reason: z
        .string()
        .min(10, "Rejection reason must be at least 10 characters")
        .max(2000, "Rejection reason must be 2000 characters or less"),
});

export const updateTherapistVerificationSchema = z.object({
    field: z.enum(Object.values(THERAPIST_VERIFICATION_FIELDS)),
    value: z.boolean(),
});

// ── Customer Management ──────────────────────────────────────────────────────

export const listCustomersQuerySchema = z.object({
    approvalStatus: z.enum(Object.values(APPROVAL_STATUS)).optional(),
    customerType: z.enum(Object.values(CUSTOMER_TYPES)).optional(),
    search: z.string().max(200).optional(),
    sortOrder: z.enum(["asc", "desc"]).optional().default("asc"),
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

export const customerUserIdParamSchema = z.object({
    customerUserId: z.string().min(1, "Invalid customer user ID"),
});

export const customerDocumentParamSchema = z.object({
    customerUserId: z.string().min(1, "Invalid customer user ID"),
    documentId: z.string().uuid("Invalid document ID"),
});

export const rejectCustomerSchema = z.object({
    reason: z
        .string()
        .min(10, "Rejection reason must be at least 10 characters")
        .max(2000, "Rejection reason must be 2000 characters or less"),
});

// ── Dispute Management ───────────────────────────────────────────────────────

export const adminListDisputesQuerySchema = z.object({
    status: z.enum(["open", "under_review", "resolved", "closed"]).optional(),
    assignedAdminId: z.string().min(1).optional(),
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
    assignedAdminId: z.string().min(1, "Invalid admin user ID"),
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
    search: z.string().max(200).optional(),
    sortBy: z.enum(["scheduledDate", "createdAt", "rate", "status"]).optional().default("createdAt"),
    sortOrder: z.enum(["asc", "desc"]).optional().default("desc"),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "startDate must be YYYY-MM-DD").optional(),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "endDate must be YYYY-MM-DD").optional(),
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

export const adminDenyRescheduleSchema = z.object({
    reason: z.string().min(5).max(500).optional(),
});

// ── Subscription Management ──────────────────────────────────────────────────

export const adminListSubscriptionsQuerySchema = z.object({
    status: z.enum(["active", "inactive", "cancelled", "past_due", "trialing", "grace_period"]).optional(),
    planType: z.enum(["free", "pro", "enterprise", "unlimited"]).optional(),
    search: z.string().max(200).optional(),
    sortBy: z.enum(["createdAt", "currentPeriodStart", "currentPeriodEnd"]).optional().default("createdAt"),
    sortOrder: z.enum(["asc", "desc"]).optional().default("desc"),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "startDate must be YYYY-MM-DD").optional(),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "endDate must be YYYY-MM-DD").optional(),
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
        .enum(["intent_created", "escrowed", "partially_released", "released", "refunded", "failed"])
        .optional(),
    search: z.string().max(200).optional(),
    sortBy: z.enum(["createdAt", "amount"]).optional().default("createdAt"),
    sortOrder: z.enum(["asc", "desc"]).optional().default("desc"),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "startDate must be YYYY-MM-DD").optional(),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "endDate must be YYYY-MM-DD").optional(),
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

export const adminReleasePaymentSchema = z.object({
    // Minimum $0.01 — sub-cent amounts round to 0 Stripe cents and are rejected
    amount: z.coerce.number().min(0.01, "Amount must be at least $0.01").optional(),
});

// ── Audit Logs ───────────────────────────────────────────────────────────────

export const adminListAuditLogsQuerySchema = z.object({
    entityType: z.string().max(50).optional(),
    action: z.string().max(100).optional(),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "startDate must be YYYY-MM-DD").optional(),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "endDate must be YYYY-MM-DD").optional(),
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
        .default("50"),
});

// ── Reports ──────────────────────────────────────────────────────────────────

export const adminReportQuerySchema = z.object({
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "startDate must be YYYY-MM-DD"),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "endDate must be YYYY-MM-DD"),
    status: z.string().max(50).optional(),
});

export const adminUserReportQuerySchema = z.object({
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "startDate must be YYYY-MM-DD"),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "endDate must be YYYY-MM-DD"),
    role: z.enum(["customer", "therapist", "admin", "sub_admin"]).optional(),
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

export const adminListCommissionHistoryQuerySchema = z.object({
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

// ── Notification Broadcast ────────────────────────────────────────────────────

export const broadcastNotificationSchema = z.object({
    role: z.enum(["all", "customer", "therapist", "admin", "sub_admin"]),
    type: z.string().min(1).max(100),
    title: z.string().min(1).max(255),
    message: z.string().min(1).max(5000),
    metadata: z.record(z.unknown()).optional(),
});