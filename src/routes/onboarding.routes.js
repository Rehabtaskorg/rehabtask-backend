import express from "express";
import {
    completeOnboardingController,
    deleteDocumentController,
    getDocumentSignedUrlController,
    getOnboardingStatusController,
    getTherapistDocumentsController,
    saveAvailabilityController,
    saveCredentialsController,
    saveProfessionalProfileController,
    submitBackgroundCheckController,
    validateFileUploadController
} from "../controllers/onboarding.controller.js";
import { authenticate } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import {
    professionalProfileSchema,
    credentialsSchema,
    availabilitySchema,
    backgroundCheckSchema,
    fileUploadMetadataSchema
} from "../validators/onboarding.schema.js";

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
 * POST /api/therapist/onboarding/background-check
 * Submit background check consent
 */
router.post(
    "/background-check",
    validate(backgroundCheckSchema),
    submitBackgroundCheckController
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
);

/**
 * GET /api/therapist/onboarding/documents
 * Get all documents for current therapist
 */
router.get("/documents", getTherapistDocumentsController);

/**
 * GET /api/therapist/onboarding/document/:documentId
 * Get signed URL for viewing a private document
 */
router.get("/document/:documentId", getDocumentSignedUrlController);

/**
 * DELETE /api/therapist/onboarding/document/:documentId
 * Soft delete a document
 */
router.delete("/document/:documentId", deleteDocumentController);

export default router;