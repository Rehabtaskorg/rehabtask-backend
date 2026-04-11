import express from "express";
import {
    cancelSessionController, completeTherapistController,
    confirmByCustomerController, getCustomerSessionsController,
    getSessionController, getTherapistSessionsController, scheduleSessionController,
    requestRevisionController, submitRevisionController,
    respondToRevisionController, resubmitSessionController,
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

export default router;