import express from "express";
import {
    advanceToFinalReviewController,
    completeOnboardingController,
    deleteDocumentController,
    getDocumentSignedUrlController,
    getOnboardingDataController,
    getOnboardingStatusController,
    getTherapistDocumentsController,
    saveAvailabilityController,
    saveCredentialsController,
    saveHipaaAttestationController,
    saveIdentityVerificationController,
    saveInsuranceController,
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
    hipaaSchema,
    insuranceSchema,
    identitySchema,
    backgroundCheckSchema,
} from "../validators/onboarding.schema.js";
import { handleMulterError, uploadDocument as uploadDocumentMiddleware, uploadImage } from "../middleware/upload.middleware.js";
import { uploadDocumentController, uploadProfilePhotoController } from "../controllers/upload.controller.js";

const router = express.Router();

// Authentication Middleware
// All routes require authentication
router.use(authenticate);

/**
 * GET /api/therapist/onboarding status
 */
router.get("/status", getOnboardingStatusController);

/**
 * GET /api/therapist/onboarding/data
 */
router.get("/data", getOnboardingDataController);

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
 * POST /api/therapist/onboarding/insurance
 */
router.post(
    "/insurance",
    validate(insuranceSchema),
    saveInsuranceController
);

/**
 * POST /api/therapist/onboarding/identity
 */
router.post(
    "/identity",
    validate(identitySchema),
    saveIdentityVerificationController
);

/**
 * POST /api/therapist/onboarding/hipaa
 */
router.post(
    "/hipaa",
    validate(hipaaSchema),
    saveHipaaAttestationController
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
 * POST /api/therapist/onboarding/advance-to-review
 */
router.post("/advance-to-review", advanceToFinalReviewController);

/**
 * POST /api/therapist/onboarding/complete
 */
router.post("/complete", completeOnboardingController);

/**
 * POST /api/therapist/onboarding/upload-document
 */
router.post(
    "/upload-document",
    uploadDocumentMiddleware,
    handleMulterError,
    uploadDocumentController
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