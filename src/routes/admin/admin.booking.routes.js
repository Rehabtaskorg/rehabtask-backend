import express from "express";
import { validate, validateMultiple } from "../../middleware/validate.js";
import { requirePermission } from "../../middleware/permissions.js";
import {
    adminListBookingsQuerySchema,
    bookingIdParamSchema,
    adminCancelBookingSchema,
    adminDenyRescheduleSchema,
} from "../../validators/admin.schema.js";
import {
    adminListBookingsController,
    adminGetBookingController,
    adminCancelBookingController,
    adminGetBookingStatsController,
    adminApproveRescheduleController,
    adminDenyRescheduleController,
} from "../../controllers/admin.booking.controller.js";
import { adminApproveCancellationController, adminRejectCancellationController } from "../../controllers/booking.cancellation.controller.js";
import { adminOrSubAdmin } from "./adminMiddleware.js";

const router = express.Router();

router.get("/bookings/stats", ...adminOrSubAdmin, requirePermission("bookings"), adminGetBookingStatsController);
router.get("/bookings", ...adminOrSubAdmin, requirePermission("bookings"), validate(adminListBookingsQuerySchema, "query"), adminListBookingsController);
router.get("/bookings/:bookingId", ...adminOrSubAdmin, requirePermission("bookings"), validate(bookingIdParamSchema, "params"), adminGetBookingController);
router.put("/bookings/:bookingId/cancel", ...adminOrSubAdmin, requirePermission("bookings"), validateMultiple({ params: bookingIdParamSchema, body: adminCancelBookingSchema }), adminCancelBookingController);
router.put("/bookings/:bookingId/approve-reschedule", ...adminOrSubAdmin, requirePermission("bookings"), validate(bookingIdParamSchema, "params"), adminApproveRescheduleController);
router.put("/bookings/:bookingId/deny-reschedule", ...adminOrSubAdmin, requirePermission("bookings"), validateMultiple({ params: bookingIdParamSchema, body: adminDenyRescheduleSchema }), adminDenyRescheduleController);
router.post("/bookings/:bookingId/cancellation/approve", ...adminOrSubAdmin, requirePermission("bookings"), validate(bookingIdParamSchema, "params"), adminApproveCancellationController);
router.post("/bookings/:bookingId/cancellation/reject", ...adminOrSubAdmin, requirePermission("bookings"), validateMultiple({ params: bookingIdParamSchema, body: adminCancelBookingSchema }), adminRejectCancellationController);

export default router;
