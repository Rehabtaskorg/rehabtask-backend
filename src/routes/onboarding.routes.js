import express from "express";
import {
    completeOnboardingController,
    getOnboardingStatusController,
    saveAvailabilityController,
    saveCredentialsController,
    saveProfessionalProfileController,
    validateFileUploadController
} from "../controllers/onboarding.controller";
import { authenticate } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import {
    professionalProfileSchema,
    credentialsSchema,
    availabilitySchema,
    backgroundCheckSchema,
    fileUploadMetadataSchema
} from "../validators/onboarding.schema";

const router = express.Router();

// Authentication Middleware
// All routes require authentication
router.use(authenticate);

/**
 * GET /api/therapist/onboarding status
 * Get current onboarding status and progress
 */
router.get("/status", getOnboardingStatusController);

/**
 * POST /api/therapist/onboarding/profile
 * Save professional profile
 */
router.post(
    "/profile",
    validate(professionalProfileSchema),
    saveProfessionalProfileController
);

/**
 * POST /api/therapist/onboarding/credentials
 * Save credentials and license documents
 */
router.post(
    "/credentials",
    validate(credentialsSchema),
    saveCredentialsController
);

/**
 * POST /api/therapist/onboarding/availability
 * Save availability schedule
 */
router.post(
    "/availability",
    validate(availabilitySchema),
    saveAvailabilityController
);

/**
 * POST /api/therapist/onboarding/complete
 * Mark onboarding as complete (after all steps)
 */
router.post("/complete", completeOnboardingController);

/**
 * POST /api/therapist/onboarding/validate-upload
 * Validate file upload metadata
 */
router.post(
    "/validate-upload",
    validate(fileUploadMetadataSchema),
    validateFileUploadController
)