import { Router } from "express";
import { authenticate, authorize } from "../middleware/auth.js";
import { getVisitTypesController, getVisitTypesByDisciplineController } from "../controllers/visitType.controller.js";

const router = Router();

// Therapist: get visit types for their discipline
router.get("/", authenticate, authorize(["therapist"]), getVisitTypesController);

// Public: get visit types by discipline query param (for customer view)
router.get("/by-discipline", authenticate, getVisitTypesByDisciplineController);

export default router;