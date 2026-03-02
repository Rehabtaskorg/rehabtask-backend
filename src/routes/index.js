import express from "express";

import authRoutes from "./auth.routes.js";
import requestRoutes from "./request.routes.js";
import offerRoutes from "./offer.routes.js";
import bookingRoutes from "./booking.routes.js";
import sessionRoutes from "./session.routes.js";
import paymentRoutes from "./payment.routes.js";
import onboardingRoutes from "./onboarding.routes.js";
import messageRoutes from "./message.routes.js";

import therapistRoutes from "./therapist.routes.js";
import therapistPublicRoutes from "./therapistPublic.routes.js";
import reviewRoutes from "./review.routes.js";
import faqRoutes from "./faq.routes.js";
import disputeRoutes from "./dispute.routes.js";
import adminRoutes from "./admin.routes.js";
import qaAdminRoutes from "./qaAdmin.routes.js"
import agencyRoutes from "./agency.routes.js";

const router = express.Router();

router.use("/auth", authRoutes);
router.use("/requests", requestRoutes);
router.use("/offers", offerRoutes);
router.use("/bookings", bookingRoutes);
router.use("/sessions", sessionRoutes);
router.use("/payments", paymentRoutes);
router.use("/therapist/onboarding", onboardingRoutes);
router.use("/messages", messageRoutes);

router.use("/therapist", therapistRoutes);
router.use("/therapists", therapistPublicRoutes);
router.use("/reviews", reviewRoutes);
router.use("/faqs", faqRoutes);
router.use("/disputes", disputeRoutes);
router.use("/admin", adminRoutes);
router.use("/qa-admin", qaAdminRoutes);
router.use("/agency", agencyRoutes);

export default router;