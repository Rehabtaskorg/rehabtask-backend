import { Router } from "express";
import { schedulerAuth } from "../middleware/schedulerAuth.js";
import {
    triggerSessionReminders,
    triggerExpireOffers,
    triggerAutoConfirm,
    triggerPaymentReminders,
    triggerSubscriptionCron,
    triggerExpiredRefunds,
    triggerRetryPendingRefunds,
    triggerCancellationExpiry,
    triggerSessionCancellationExpiry,
    triggerPurgeWebhookEvents,
    triggerReviewExpirySms,
    triggerRevisionExpirySms,
} from "../controllers/jobs.controller.js";

const router = Router();

router.use(schedulerAuth);

router.post("/session-reminders", triggerSessionReminders);
router.post("/expire-offers", triggerExpireOffers);
router.post("/auto-confirm", triggerAutoConfirm);
router.post("/payment-reminders", triggerPaymentReminders);
router.post("/subscription-cron", triggerSubscriptionCron);
router.post("/expired-refunds", triggerExpiredRefunds);
router.post("/retry-pending-refunds", triggerRetryPendingRefunds);
router.post("/cancellation-expiry", triggerCancellationExpiry);
router.post("/session-cancellation-expiry", triggerSessionCancellationExpiry);
router.post("/purge-webhook-events", triggerPurgeWebhookEvents);
router.post("/review-expiry-sms", triggerReviewExpirySms);
router.post("/revision-expiry-sms", triggerRevisionExpirySms);

export default router;
