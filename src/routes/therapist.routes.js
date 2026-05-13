import { USER_ROLES } from "../utils/constants.js";
import express from "express";
import {
    getTherapistProfileController,
    updateTherapistProfileController,
    updateWorkAreasController,
    updateAvailabilityController
} from "../controllers/therapist.controller.js";
import { authenticate, authorize } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import {
    updateProfileSchema,
    updateWorkAreasSchema,
    updateAvailabilitySchema
} from "../validators/therapist.schema.js";

const router = express.Router();

// GET /api/therapist/profile - Get own full profile
router.get(
    "/profile",
    authenticate,
    authorize([USER_ROLES.THERAPIST]),
    getTherapistProfileController
);

// PUT /api/therapist/profile - Update profile fields
router.put(
    "/profile",
    authenticate,
    authorize([USER_ROLES.THERAPIST]),
    validate(updateProfileSchema),
    updateTherapistProfileController
);

// PUT /api/therapist/work-areas — Replace work areas
router.put(
    "/work-areas",
    authenticate,
    authorize([USER_ROLES.THERAPIST]),
    validate(updateWorkAreasSchema),
    updateWorkAreasController
);

// PUT /api/therapist/availability — Replace availability
router.put(
    "/availability",
    authenticate,
    authorize([USER_ROLES.THERAPIST]),
    validate(updateAvailabilitySchema),
    updateAvailabilityController
);

export default router;