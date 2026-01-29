import express from "express";
import {
    getBookingByIdController, getCustomerBookingsController,
    getTherapistBookingsController
} from "../controllers/booking.controller.js";
import { authenticate, authorize } from "../middleware/auth.js";

const router = express.Router();

router.get("/customer", authenticate, authorize(["customer"]), getCustomerBookingsController);
router.get("/therapist", authenticate, authorize(["therapist"]), getTherapistBookingsController);
router.get("/:bookingId", authenticate, getBookingByIdController);

export default router;