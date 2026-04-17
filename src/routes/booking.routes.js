import express from "express";
import {
    getBookingByIdController, getCustomerBookingsController,
    getTherapistBookingsController,
    rescheduleBookingController,
    respondToRescheduleController,
    finalizeBookingController,
    getBookingConversationController,
} from "../controllers/booking.controller.js";
import { authenticate, authorize } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { rescheduleSchema, respondToRescheduleSchema } from "../validators/offer.schema.js";

const router = express.Router();

router.get("/customer", authenticate, authorize(["customer"]), getCustomerBookingsController);
router.get("/therapist", authenticate, authorize(["therapist"]), getTherapistBookingsController);
router.get("/:bookingId", authenticate, getBookingByIdController);
router.post("/:bookingId/reschedule", authenticate, authorize(["therapist"]), validate(rescheduleSchema), rescheduleBookingController);
router.post("/:bookingId/reschedule/respond", authenticate, authorize(["customer"]), validate(respondToRescheduleSchema), respondToRescheduleController)
router.post("/:bookingId/finalize", authenticate, authorize(["therapist"]), finalizeBookingController);
router.get("/:bookingId/conversation", authenticate, getBookingConversationController);

export default router;