import { USER_ROLES } from "../utils/constants.js";
import express from "express";
import { authenticate, authorize } from "../middleware/auth.js";
import { validate, validateMultiple } from "../middleware/validate.js";
import { requirePermission } from "../middleware/permissions.js";

// Validators
import { createFaqSchema, updateFaqSchema, } from "../validators/faq.schema.js";
import {
    listUsersQuerySchema, userIdParamSchema, listTherapistsQuerySchema, therapistUserIdParamSchema, therapistDocumentParamSchema, rejectTherapistSchema,
    updateTherapistVerificationSchema,
    adminListDisputesQuerySchema, disputeIdParamSchema, assignDisputeSchema, adminUpdateDisputeSchema, adminListBookingsQuerySchema,
    bookingIdParamSchema, adminCancelBookingSchema, adminDenyRescheduleSchema, adminListSubscriptionsQuerySchema, subscriptionIdParamSchema,
    adminListPaymentsQuerySchema, paymentIdParamSchema, adminRefundPaymentSchema, adminReleasePaymentSchema,
    createSubAdminSchema, promoteToSubAdminSchema, updateSubAdminPermissionsSchema,
    setCommissionRateSchema, adminListCommissionHistoryQuerySchema,
    sendEmailSchema, broadcastNotificationSchema, updateUserSchema, adminListAuditLogsQuerySchema,
    adminReportQuerySchema, adminUserReportQuerySchema,
} from "../validators/admin.schema.js";

// Controllers
import {
    adminGetAllFaqsController,
    adminCreateFaqController,
    adminUpdateFaqController,
    adminDeleteFaqController
} from "../controllers/admin.controller.js";

import {
    listUsersController,
    getUserDetailController,
    deactivateUserController,
    reactivateUserController,
    updateUserController,
    sendEmailController,
} from "../controllers/admin.user.controller.js";

import {
    listTherapistsController,
    getTherapistDetailController,
    approveTherapistController,
    rejectTherapistController,
    updateTherapistVerificationController,
    getDocumentSignedUrlController,
} from "../controllers/admin.therapist.controller.js";

import {
    adminListDisputesController,
    adminGetDisputeController,
    assignDisputeController,
    adminUpdateDisputeController,
    reopenDisputeController,
} from "../controllers/admin.dispute.controller.js";

import {
    adminGetVisitTypesController,
    adminUpdateVisitTypeController,
    adminSeedVisitTypesController,
} from "../controllers/visitType.controller.js";

import {
    adminListBookingsController,
    adminGetBookingController,
    adminCancelBookingController,
    adminGetBookingStatsController,
    adminApproveRescheduleController,
    adminDenyRescheduleController,
} from "../controllers/admin.booking.controller.js";
import { adminApproveCancellationController, adminRejectCancellationController } from "../controllers/booking.cancellation.controller.js";

import {
    adminListSubscriptionsController,
    adminGetSubscriptionController,
    adminCancelSubscriptionController,
    adminGetSubscriptionStatsController,
} from "../controllers/admin.subscription.controller.js";

import {
    adminListPaymentsController,
    adminGetPaymentController,
    adminGetPaymentStatsController,
    adminReleasePaymentController,
    adminReleaseRemainderController,
    adminRefundPaymentController,
} from "../controllers/admin.payment.controller.js";

import {
    listSubAdminsController,
    getSubAdminDetailController,
    createSubAdminController,
    promoteToSubAdminController,
    updateSubAdminPermissionsController,
    deactivateSubAdminController,
    reactivateSubAdminController,
    resendSubAdminInviteController,
} from "../controllers/admin.subadmin.controller.js";

import {
    getCommissionRateController,
    setCommissionRateController,
    getCommissionHistoryController,
} from "../controllers/admin.commission.controller.js";

import {
    adminGetAllNotificationsController,
    adminBroadcastNotificationController,
} from "../controllers/admin.notification.controller.js";

import { adminListAuditLogsController } from "../controllers/admin.audit.controller.js";

import {
    bookingsReportController,
    paymentsReportController,
    usersReportController,
} from "../controllers/admin.report.controller.js";


const router = express.Router();

// Middleware shorthand
const adminOrSubAdmin = [authenticate, authorize([USER_ROLES.ADMIN, USER_ROLES.SUB_ADMIN])];
const adminOnly = [authenticate, authorize([USER_ROLES.ADMIN])];

// ── FAQ Management ──
router.get("/faqs", ...adminOrSubAdmin, requirePermission("faqs"), adminGetAllFaqsController);
router.post("/faqs", ...adminOrSubAdmin, requirePermission("faqs"), validate(createFaqSchema), adminCreateFaqController);
router.put("/faqs/:faqId", ...adminOrSubAdmin, requirePermission("faqs"), validate(updateFaqSchema), adminUpdateFaqController);
router.delete("/faqs/:faqId", ...adminOrSubAdmin, requirePermission("faqs"), adminDeleteFaqController);

// Direct email (admin-only — no sub-admin, no userId required)
router.post("/email", ...adminOnly, validate(sendEmailSchema), sendEmailController);

// User Management
router.get("/users", ...adminOrSubAdmin, requirePermission("users"), validate(listUsersQuerySchema, "query"), listUsersController);
router.get("/users/:userId", ...adminOrSubAdmin, requirePermission("users"), validate(userIdParamSchema, "params"), getUserDetailController);
router.put("/users/:userId", ...adminOrSubAdmin, requirePermission("users"), validateMultiple({ params: userIdParamSchema, body: updateUserSchema }), updateUserController);
router.put("/users/:userId/deactivate", ...adminOrSubAdmin, requirePermission("users"), validate(userIdParamSchema, "params"), deactivateUserController);
router.put("/users/:userId/reactivate", ...adminOrSubAdmin, requirePermission("users"), validate(userIdParamSchema, "params"), reactivateUserController);

// Therapist Management
router.get("/therapists", ...adminOrSubAdmin, requirePermission("therapists"), validate(listTherapistsQuerySchema, "query"), listTherapistsController);
router.get("/therapists/:therapistUserId", ...adminOrSubAdmin, requirePermission("therapists"), validate(therapistUserIdParamSchema, "params"), getTherapistDetailController);
router.put("/therapists/:therapistUserId/approve", ...adminOrSubAdmin, requirePermission("therapists"), validate(therapistUserIdParamSchema, "params"), approveTherapistController);
router.put("/therapists/:therapistUserId/reject", ...adminOrSubAdmin, requirePermission("therapists"), validateMultiple({ params: therapistUserIdParamSchema, body: rejectTherapistSchema }), rejectTherapistController);
router.put("/therapists/:therapistUserId/verification", ...adminOrSubAdmin, requirePermission("therapists"), validateMultiple({ params: therapistUserIdParamSchema, body: updateTherapistVerificationSchema }), updateTherapistVerificationController);
router.get("/therapists/:therapistUserId/documents/:documentId", ...adminOrSubAdmin, requirePermission("therapists"), validate(therapistDocumentParamSchema, "params"), getDocumentSignedUrlController);

// Dispute Management
router.get("/disputes", ...adminOrSubAdmin, requirePermission("disputes"), validate(adminListDisputesQuerySchema, "query"), adminListDisputesController);
router.get("/disputes/:disputeId", ...adminOrSubAdmin, requirePermission("disputes"), validate(disputeIdParamSchema, "params"), adminGetDisputeController);
router.put("/disputes/:disputeId", ...adminOrSubAdmin, requirePermission("disputes"), validateMultiple({ params: disputeIdParamSchema, body: adminUpdateDisputeSchema }), adminUpdateDisputeController);
router.put("/disputes/:disputeId/assign", ...adminOrSubAdmin, requirePermission("disputes"), validateMultiple({ params: disputeIdParamSchema, body: assignDisputeSchema }), assignDisputeController);
router.put("/disputes/:disputeId/reopen", ...adminOrSubAdmin, requirePermission("disputes"), validate(disputeIdParamSchema, "params"), reopenDisputeController);

// Booking Management
router.get("/bookings/stats", ...adminOrSubAdmin, requirePermission("bookings"), adminGetBookingStatsController);
router.get("/bookings", ...adminOrSubAdmin, requirePermission("bookings"), validate(adminListBookingsQuerySchema, "query"), adminListBookingsController);
router.get("/bookings/:bookingId", ...adminOrSubAdmin, requirePermission("bookings"), validate(bookingIdParamSchema, "params"), adminGetBookingController);
router.put("/bookings/:bookingId/cancel", ...adminOrSubAdmin, requirePermission("bookings"), validateMultiple({ params: bookingIdParamSchema, body: adminCancelBookingSchema }), adminCancelBookingController);
router.put("/bookings/:bookingId/approve-reschedule", ...adminOrSubAdmin, requirePermission("bookings"), validate(bookingIdParamSchema, "params"), adminApproveRescheduleController);
router.put("/bookings/:bookingId/deny-reschedule", ...adminOrSubAdmin, requirePermission("bookings"), validateMultiple({ params: bookingIdParamSchema, body: adminDenyRescheduleSchema }), adminDenyRescheduleController);
router.post("/bookings/:bookingId/cancellation/approve", ...adminOrSubAdmin, requirePermission("bookings"), validate(bookingIdParamSchema, "params"), adminApproveCancellationController);
router.post("/bookings/:bookingId/cancellation/reject", ...adminOrSubAdmin, requirePermission("bookings"), validateMultiple({ params: bookingIdParamSchema, body: adminCancelBookingSchema }), adminRejectCancellationController);

// Subscription Management
router.get("/subscriptions/stats", ...adminOrSubAdmin, requirePermission("subscriptions"), adminGetSubscriptionStatsController);
router.get("/subscriptions", ...adminOrSubAdmin, requirePermission("subscriptions"), validate(adminListSubscriptionsQuerySchema, "query"), adminListSubscriptionsController);
router.get("/subscriptions/:subscriptionId", ...adminOrSubAdmin, requirePermission("subscriptions"), validate(subscriptionIdParamSchema, "params"), adminGetSubscriptionController);
router.put("/subscriptions/:subscriptionId/cancel", ...adminOrSubAdmin, requirePermission("subscriptions"), validate(subscriptionIdParamSchema, "params"), adminCancelSubscriptionController);

// Payment Management
router.get("/payments/stats", ...adminOrSubAdmin, requirePermission("payments"), adminGetPaymentStatsController);
router.get("/payments", ...adminOrSubAdmin, requirePermission("payments"), validate(adminListPaymentsQuerySchema, "query"), adminListPaymentsController);
router.get("/payments/:paymentId", ...adminOrSubAdmin, requirePermission("payments"), validate(paymentIdParamSchema, "params"), adminGetPaymentController);
router.put("/payments/:paymentId/release", ...adminOrSubAdmin, requirePermission("payments"), validateMultiple({ params: paymentIdParamSchema, body: adminReleasePaymentSchema }), adminReleasePaymentController);
router.put("/payments/:paymentId/release-remainder", ...adminOrSubAdmin, requirePermission("payments"), validateMultiple({ params: paymentIdParamSchema }), adminReleaseRemainderController);
router.put("/payments/:paymentId/refund", ...adminOrSubAdmin, requirePermission("payments"), validateMultiple({ params: paymentIdParamSchema, body: adminRefundPaymentSchema }), adminRefundPaymentController);

// Commission Management
router.get("/commission/rates", ...adminOrSubAdmin, requirePermission("commission"), getCommissionRateController);
router.get("/commission/history", ...adminOrSubAdmin, requirePermission("commission"), validate(adminListCommissionHistoryQuerySchema, "query"), getCommissionHistoryController);
router.post("/commission/rates", ...adminOnly, validate(setCommissionRateSchema), setCommissionRateController);

// Notifications (admin view + broadcast)
router.get("/notifications", ...adminOrSubAdmin, requirePermission("notifications"), adminGetAllNotificationsController);
router.post("/notifications/broadcast", ...adminOnly, validate(broadcastNotificationSchema), adminBroadcastNotificationController);

// Sub-Admin Management (admin only)
router.get("/sub-admins", ...adminOnly, listSubAdminsController);
router.post("/sub-admins", ...adminOnly, validate(createSubAdminSchema), createSubAdminController);
router.get("/sub-admins/:userId", ...adminOnly, validate(userIdParamSchema, "params"), getSubAdminDetailController);
router.post("/sub-admins/:userId/promote", ...adminOnly, validateMultiple({ params: userIdParamSchema, body: promoteToSubAdminSchema }), promoteToSubAdminController);
router.put("/sub-admins/:userId/permissions", ...adminOnly, validateMultiple({ params: userIdParamSchema, body: updateSubAdminPermissionsSchema }), updateSubAdminPermissionsController);
router.put("/sub-admins/:userId/deactivate", ...adminOnly, validate(userIdParamSchema, "params"), deactivateSubAdminController);
router.put("/sub-admins/:userId/reactivate", ...adminOnly, validate(userIdParamSchema, "params"), reactivateSubAdminController);
router.post("/sub-admins/:userId/resend-invite", ...adminOnly, validate(userIdParamSchema, "params"), resendSubAdminInviteController);

// Audit Logs — full admins only (append-only, no sub-admin access)
router.get("/audit-logs", ...adminOnly, validate(adminListAuditLogsQuerySchema, "query"), adminListAuditLogsController);

// Reports — full admins only
router.get("/reports/bookings", ...adminOnly, validate(adminReportQuerySchema, "query"), bookingsReportController);
router.get("/reports/payments", ...adminOnly, validate(adminReportQuerySchema, "query"), paymentsReportController);
router.get("/reports/users", ...adminOnly, validate(adminUserReportQuerySchema, "query"), usersReportController);

router.get("/visit-types", ...adminOnly, adminGetVisitTypesController);
router.put("/visit-types/:id", ...adminOnly, adminUpdateVisitTypeController);
router.post("/visit-types/seed", ...adminOnly, adminSeedVisitTypesController);


export default router;