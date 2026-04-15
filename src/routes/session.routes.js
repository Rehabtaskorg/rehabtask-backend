import express from "express";
import {
    cancelSessionController, completeTherapistController,
    confirmByCustomerController, getCustomerSessionsController,
    getSessionController, getTherapistSessionsController, scheduleSessionController,
    requestRevisionController, submitRevisionController,
    respondToRevisionController, resubmitSessionController,
    markMissedByTherapistController, markMissedByCustomerController,
} from "../controllers/session.controller.js";
import { authenticate, authorize } from "../middleware/auth.js";

const router = express.Router();

router.get("/customer", authenticate, authorize(["customer"]), getCustomerSessionsController);
router.get("/therapist", authenticate, authorize(["therapist"]), getTherapistSessionsController);
router.get("/:sessionId", authenticate, getSessionController);
router.post("/:sessionId/complete", authenticate, authorize(["therapist"]), completeTherapistController);
router.post("/:sessionId/confirm", authenticate, authorize(["customer"]), confirmByCustomerController);
router.post("/:sessionId/cancel", authenticate, cancelSessionController);
router.post("/:sessionId/schedule", authenticate, authorize(["therapist"]), scheduleSessionController);
router.post("/:sessionId/request-revision", authenticate, authorize(["customer"]), requestRevisionController);
// Legacy endpoint — kept for backward compat. Calls respondToRevision + resubmitSession in sequence.
router.post("/:sessionId/submit-revision", authenticate, authorize(["therapist"]), submitRevisionController);
// New two-step revision flow
router.post("/:sessionId/revision-respond", authenticate, authorize(["therapist"]), respondToRevisionController);
router.post("/:sessionId/revision-resubmit", authenticate, authorize(["therapist"]), resubmitSessionController);

// Missed visit (no-show). Two distinct endpoints for clear authorization + audit differentiation.
//   Therapist: self-report they couldn't attend
//   Customer:  report a therapist no-show (hard-blocked until scheduledDate has passed)
router.post("/:sessionId/mark-missed-by-therapist", authenticate, authorize(["therapist"]), markMissedByTherapistController);
router.post("/:sessionId/mark-missed-by-customer", authenticate, authorize(["customer"]), markMissedByCustomerController);

export default router;