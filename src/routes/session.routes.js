import express from "express";
import {
    cancelSessionController, completeTherapistController,
    confirmByCustomerController, getCustomerSessionsController,
    getSessionController, getTherapistSessionsController, scheduleSessionController,
    requestRevisionController, submitRevisionController
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
router.post("/:sessionId/submit-revision", authenticate, authorize(["therapist"]), submitRevisionController);

export default router;