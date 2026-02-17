import express from "express";

import authRoutes from "./auth.routes.js";
import requestRoutes from "./request.routes.js";
import offerRoutes from "./offer.routes.js";
import bookingRoutes from "./booking.routes.js";
import sessionRoutes from "./session.routes.js";
import paymentRoutes from "./payment.routes.js";
import onboardingRoutes from "./onboarding.routes.js";
import messageRoutes from "./message.routes.js";

const router = express.Router();

router.use("/auth", authRoutes);
router.use("/requests", requestRoutes);
router.use("/offers", offerRoutes);
router.use("/bookings", bookingRoutes);
router.use("/sessions", sessionRoutes);
router.use("/payments", paymentRoutes);
router.use("/therapist/onboarding", onboardingRoutes);
router.use("/messages", messageRoutes);

export default router;