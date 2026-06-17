import express from "express";
import {
    completeOnboardingController,
    deleteDocumentController,
    getDocumentSignedUrlController,
    getOnboardingStatusController,
    getTherapistDocumentsController,
    saveAvailabilityController,
    saveCredentialsController,
    savePersonalInfoController,
    saveProfessionalProfileController,
    submitBackgroundCheckController,
} from "../controllers/onboarding.controller.js";
import { authenticate } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import {
    personalInfoSchema,
    professionalProfileSchema,
    credentialsSchema,
    availabilitySchema,
    backgroundCheckSchema,
} from "../validators/onboarding.schema.js";
import { handleMulterError, uploadDocument, uploadImage } from "../middleware/upload.middleware.js";
import { uploadLicenseDocumentController, uploadProfilePhotoController } from "../controllers/upload.controller.js";

const router = express.Router();

// Authentication Middleware
// All routes require authentication
router.use(authenticate);

/**
 * GET /api/therapist/onboarding status
 */
router.get("/status", getOnboardingStatusController);

/**
 * POST /api/therapist/onboarding/personal-info
 */
router.post(
    "/personal-info",
    validate(personalInfoSchema),
    savePersonalInfoController
);

/**
 * POST /api/therapist/onboarding/profile
 */
router.post(
    "/profile",
    validate(professionalProfileSchema),
    saveProfessionalProfileController
);

/**
 * POST /api/therapist/onboarding/credentials
 */
router.post(
    "/credentials",
    validate(credentialsSchema),
    saveCredentialsController
);

/**
 * POST /api/therapist/onboarding/availability
 */
router.post(
    "/availability",
    validate(availabilitySchema),
    saveAvailabilityController
);

/**
 * POST /api/therapist/onboarding/background-check
 */
router.post(
    "/background-check",
    validate(backgroundCheckSchema),
    submitBackgroundCheckController
);

/**
 * POST /api/therapist/onboarding/complete
 */
router.post("/complete", completeOnboardingController);

/**
 * POST /api/therapist/onboarding/upload-document
 */
router.post(
    "/upload-document",
    uploadDocument,
    handleMulterError,
    uploadLicenseDocumentController
);

/**
 * POST /api/therapist/onboarding/upload-profile-photo
 */
router.post(
    "/upload-profile-photo",
    uploadImage,
    handleMulterError,
    uploadProfilePhotoController
);

/**
 * GET /api/therapist/onboarding/documents
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