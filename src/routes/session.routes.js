import { USER_ROLES } from "../utils/constants.js";
import express from "express";
import {
    cancelSessionController, completeTherapistController,
    confirmByCustomerController, getCustomerSessionsController,
    getSessionController, getTherapistSessionsController, scheduleSessionController,
    requestRevisionController, submitRevisionController,
    respondToRevisionController, resubmitSessionController,
    markMissedByTherapistController, markMissedByCustomerController,
    markAttemptedByTherapistController,
} from "../controllers/session.controller.js";
import { authenticate, authorize } from "../middleware/auth.js";

const router = express.Router();

router.get("/customer", authenticate, authorize([USER_ROLES.CUSTOMER]), getCustomerSessionsController);
router.get("/therapist", authenticate, authorize([USER_ROLES.THERAPIST]), getTherapistSessionsController);
router.get("/:sessionId", authenticate, getSessionController);
router.post("/:sessionId/complete", authenticate, authorize([USER_ROLES.THERAPIST]), completeTherapistController);
router.post("/:sessionId/confirm", authenticate, authorize([USER_ROLES.CUSTOMER]), confirmByCustomerController);
router.post("/:sessionId/cancel", authenticate, cancelSessionController);
router.post("/:sessionId/schedule", authenticate, authorize([USER_ROLES.THERAPIST]), scheduleSessionController);
router.post("/:sessionId/request-revision", authenticate, authorize([USER_ROLES.CUSTOMER]), requestRevisionController);
// Legacy endpoint — kept for backward compat. Calls respondToRevision + resubmitSession in sequence.
router.post("/:sessionId/submit-revision", authenticate, authorize([USER_ROLES.THERAPIST]), submitRevisionController);
// New two-step revision flow
router.post("/:sessionId/revision-respond", authenticate, authorize([USER_ROLES.THERAPIST]), respondToRevisionController);
router.post("/:sessionId/revision-resubmit", authenticate, authorize([USER_ROLES.THERAPIST]), resubmitSessionController);

// Missed visit (no-show). Two distinct endpoints for clear authorization + audit differentiation.
//   Therapist: self-report they couldn't attend
//   Customer:  report a therapist no-show (hard-blocked until scheduledDate has passed)
router.post("/:sessionId/mark-missed-by-therapist", authenticate, authorize([USER_ROLES.THERAPIST]), markMissedByTherapistController);
router.post("/:sessionId/mark-missed-by-customer", authenticate, authorize([USER_ROLES.CUSTOMER]), markMissedByCustomerController);

// Attempted visit (therapist arrived, patient not home). Therapist-only by design
// per the business rules — customer disputes go through the Resolution Center.
router.post("/:sessionId/mark-attempted", authenticate, authorize([USER_ROLES.THERAPIST]), markAttemptedByTherapistController);

export default router;