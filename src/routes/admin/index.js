import express from "express";

import faqRoutes from "./admin.faq.routes.js";
import emailRoutes from "./admin.email.routes.js";
import userRoutes from "./admin.user.routes.js";
import therapistRoutes from "./admin.therapist.routes.js";
import customerRoutes from "./admin.customer.routes.js";
import disputeRoutes from "./admin.dispute.routes.js";
import bookingRoutes from "./admin.booking.routes.js";
import subscriptionRoutes from "./admin.subscription.routes.js";
import paymentRoutes from "./admin.payment.routes.js";
import commissionRoutes from "./admin.commission.routes.js";
import notificationRoutes from "./admin.notification.routes.js";
import subadminRoutes from "./admin.subadmin.routes.js";
import auditRoutes from "./admin.audit.routes.js";
import reportRoutes from "./admin.report.routes.js";
import visitTypeRoutes from "./admin.visitType.routes.js";

const router = express.Router();

router.use(faqRoutes);
router.use(emailRoutes);
router.use(userRoutes);
router.use(therapistRoutes);
router.use(customerRoutes);
router.use(disputeRoutes);
router.use(bookingRoutes);
router.use(subscriptionRoutes);
router.use(paymentRoutes);
router.use(commissionRoutes);
router.use(notificationRoutes);
router.use(subadminRoutes);
router.use(auditRoutes);
router.use(reportRoutes);
router.use(visitTypeRoutes);

export default router;
