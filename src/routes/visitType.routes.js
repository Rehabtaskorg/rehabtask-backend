import { Router } from "express";
import { authenticate } from "../middleware/auth.js";
import {
    getVisitTypesController,
    getVisitTypesByDisciplineController,
} from "../controllers/visitType.controller.js";

const router = Router();

// Unified endpoint — both customer and therapist audiences.
// Query params: serviceType, licenseType, discipline, audience.
// Therapists calling with no params get their own discipline (legacy behavior).
router.get("/", authenticate, getVisitTypesController);

// Legacy alias kept for older clients.
router.get("/by-discipline", authenticate, getVisitTypesByDisciplineController);

export default router;
