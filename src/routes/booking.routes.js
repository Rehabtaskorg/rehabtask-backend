import { USER_ROLES } from "../utils/constants.js";
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

router.get("/customer", authenticate, authorize([USER_ROLES.CUSTOMER]), getCustomerBookingsController);
router.get("/therapist", authenticate, authorize([USER_ROLES.THERAPIST]), getTherapistBookingsController);
router.get("/:bookingId", authenticate, getBookingByIdController);
router.post("/:bookingId/reschedule", authenticate, authorize([USER_ROLES.THERAPIST]), validate(rescheduleSchema), rescheduleBookingController);
router.post("/:bookingId/reschedule/respond", authenticate, authorize([USER_ROLES.CUSTOMER]), validate(respondToRescheduleSchema), respondToRescheduleController)
router.post("/:bookingId/finalize", authenticate, authorize([USER_ROLES.THERAPIST]), finalizeBookingController);
router.get("/:bookingId/conversation", authenticate, getBookingConversationController);

export default router;