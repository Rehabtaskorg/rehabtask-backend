import { Router } from "express";
import { authenticate, requireRole } from "../middleware/auth.js";
import { getVisitTypesController, getVisitTypesByDisciplineController } from "../controllers/visitType.controller.js";

const router = Router();

// Therapist: get visit types for their discipline
router.get("/", authenticate, requireRole("therapist"), getVisitTypesController);

// Public: get visit types by discipline query param (for customer view)
router.get("/by-discipline", authenticate, getVisitTypesByDisciplineController);

export default router;