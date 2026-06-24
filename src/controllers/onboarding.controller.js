import {
    advanceToFinalReview,
    completeOnboarding,
    deleteDocument,
    getComplianceContent,
    getDocumentSignedUrl,
    getOnboardingData,
    getOnboardingStatus,
    getTherapistDocuments,
    saveAvailability,
    saveCredentials,
    saveIdentityVerification,
    saveInsurance,
    savePersonalInfo,
    saveProfessionalProfile,
    signComplianceDocument,
    submitBackgroundCheck,
    getAgencyOnboardingStatus,
    getAgencyOnboardingData,
    saveAgencyBusinessProfile,
    saveAgencyUploadDocuments,
    deleteAgencyDocument,
    getAgencyComplianceContent,
    signAgencyComplianceDocument,
} from "../services/onboarding.service.js";
import { uploadAgencyDocument } from "../services/upload.service.js";
import { BadRequestError } from "../utils/errors.js";

/**
 * Get client IP address from the request
 */
const getClientIp = (req) => {
    return req.headers['x-forwarded-for']?.split(',')[0].trim() ||
        req.headers['x-real-ip'] ||
        req.connection?.remoteAddress ||
        req.socket?.remoteAddress ||
        null;
};

/**
 * GET /api/therapist/onboarding/status
 * Get onboarding status and progress
 */
export const getOnboardingStatusController = async (req, res, next) => {
    try {
        const result = await getOnboardingStatus(req.user.id);

        res.status(200).json({
            success: true,
            data: result
        });
    } catch (error) {
        next(error);
    }
}

/**
 * GET /api/therapist/onboarding/data
 * Get every previously-saved onboarding field value, so step forms can
 * repopulate themselves on mount instead of relying on the Zustand store.
 */
export const getOnboardingDataController = async (req, res, next) => {
    try {
        const result = await getOnboardingData(req.user.id);

        res.status(200).json({
            success: true,
            data: result
        });
    } catch (error) {
        next(error);
    }
}

/**
 * POST /api/therapist/onboarding/personal-info
 * Save personal information (Step 1)
 */
export const savePersonalInfoController = async (req, res, next) => {
    try {
        const {
            dateOfBirth,
            phone,
            addressLine1,
            addressLine2,
            city,
            state,
            zipCode,
            latitude,
            longitude,
            emergencyContactName,
            emergencyContactPhone,
        } = req.body;

        const result = await savePersonalInfo(req.user.id, {
            dateOfBirth,
            phone,
            addressLine1,
            addressLine2,
            city,
            state,
            zipCode,
            latitude,
            longitude,
            emergencyContactName,
            emergencyContactPhone,
        });

        res.status(200).json({
            success: true,
            message: result.message,
            data: {
                therapist: result.therapist,
            },
        });
    } catch (error) {
        next(error);
    }
};

/**
 * POST /api/therapist/onboarding/profile
 * Save professional profile (Step 2)
 */
export const saveProfessionalProfileController = async (req, res, next) => {
    try {
        const { yearsOfExperience, primaryLicenseType, specialization, professionalSummary, profilePhotoUrl } = req.body;

        const result = await saveProfessionalProfile(req.user.id, {
            yearsOfExperience,
            primaryLicenseType,
            specialization,
            professionalSummary,
            profilePhotoUrl
        });

        res.status(200).json({
            success: true,
            message: result.message,
            data: {
                therapist: result.therapist
            },
        });
    } catch (error) {
        next(error);
    }
}

/**
 * POST /api/therapist/onboarding/credentials
 * Save credentials (Step 2)
 */
export const saveCredentialsController = async (req, res, next) => {
    try {
        const {
            licenseNumber,
            licenseState,
            npiNumber,
            additionalLicenseStates,
            licenseDocuments,
            ratePerVisit,
            attemptedVisitRate,
        } = req.body;
        const uploadIp = getClientIp(req);

        const result = await saveCredentials(req.user.id,
            {
                licenseNumber,
                licenseState,
                npiNumber,
                additionalLicenseStates,
                licenseDocuments,
                ratePerVisit,
                attemptedVisitRate,
            }, uploadIp
        );

        res.status(200).json({
            success: true,
            message: result.message,
            data: {
                therapist: result.therapist,
                documents: result.documents,
            },
        });
    } catch (error) {
        next(error);
    }
}

/**
 * POST /api/therapist/onboarding/availability
 * Save availability (Step 3)
 */
export const saveAvailabilityController = async (req, res, next) => {
    try {
        const { schedule, acceptingNewPatients, workAreas } = req.body;

        const result = await saveAvailability(req.user.id, {
            schedule,
            acceptingNewPatients,
            workAreas: workAreas || [],
        });

        res.status(200).json({
            success: true,
            message: result.message,
            data: {
                therapist: result.therapist,
            },
        });
    } catch (error) {
        next(error);
    }
}

/**
 * POST /api/therapist/onboarding/insurance
 * Save insurance documentation (Step 5)
 */
export const saveInsuranceController = async (req, res, next) => {
    try {
        const { doesHomeVisits, documents } = req.body;

        const result = await saveInsurance(req.user.id, { doesHomeVisits, documents });

        res.status(200).json({
            success: true,
            message: result.message,
            data: {
                therapist: result.therapist,
                documents: result.documents,
            },
        });
    } catch (error) {
        next(error);
    }
}

/**
 * POST /api/therapist/onboarding/identity
 * Save identity verification documents (Step 6)
 */
export const saveIdentityVerificationController = async (req, res, next) => {
    try {
        const { documents } = req.body;

        const result = await saveIdentityVerification(req.user.id, { documents });

        res.status(200).json({
            success: true,
            message: result.message,
            data: {
                therapist: result.therapist,
                documents: result.documents,
            },
        });
    } catch (error) {
        next(error);
    }
}

/**
 * GET /api/therapist/onboarding/compliance/content
 * Get the Compliance Forms step's rendered document previews + sign status (Step 7)
 */
export const getComplianceContentController = async (req, res, next) => {
    try {
        const result = await getComplianceContent(req.user.id);

        res.status(200).json({
            success: true,
            data: result,
        });
    } catch (error) {
        next(error);
    }
}

/**
 * POST /api/therapist/onboarding/compliance/sign
 * Record a signature on one of the 3 Compliance Forms e-signature documents (Step 7)
 */
export const signComplianceController = async (req, res, next) => {
    try {
        const { documentType, signature } = req.body;

        const result = await signComplianceDocument(req.user.id, { documentType, signature });

        res.status(200).json({
            success: true,
            message: result.message,
            data: {
                therapist: result.therapist,
            },
        });
    } catch (error) {
        next(error);
    }
}

/**
 * POST /api/therapist/onboarding/background-check
 * Submit background check (Step 4)
 */
export const submitBackgroundCheckController = async (req, res, next) => {
    try {
        const { consent, signature } = req.body;

        const result = await submitBackgroundCheck(req.user.id, {
            consent,
            signature
        });

        res.status(200).json({
            success: true,
            message: result.message,
            data: {
                therapist: result.therapist
            },
        });
    } catch (error) {
        next(error);
    }
}

/**
 * POST /api/therapist/onboarding/advance-to-review
 * Advance to Final Review (step 9) after Stripe is finished or skipped
 */
export const advanceToFinalReviewController = async (req, res, next) => {
    try {
        const result = await advanceToFinalReview(req.user.id);

        res.status(200).json({
            success: true,
            result: result.message,
            data: {
                therapist: result.therapist
            },
        });
    } catch (error) {
        next(error);
    }
}

/**
 * POST /api/therapist/onboarding/complete
 * Complete onboarding (after all steps)
 */
export const completeOnboardingController = async (req, res, next) => {
    try {
        const result = await completeOnboarding(req.user.id);

        res.status(200).json({
            success: true,
            result: result.message,
            data: {
                therapist: result.therapist
            },
        });
    } catch (error) {
        next(error);
    }
}

/**
 * GET /api/therapist/onboarding/document/:documentId
 * Get signed URL for document
 */
export const getDocumentSignedUrlController = async (req, res, next) => {
    try {
        const { documentId } = req.params;

        const result = await getDocumentSignedUrl(req.user.id, documentId);

        res.status(200).json({
            success: true,
            data: result,
        });
    } catch (error) {
        next(error);
    }
}

/**
 * GET /api/therapist/onboarding/documents
 * Get all therapist documents
 */
export const getTherapistDocumentsController = async (req, res, next) => {
    try {
        const result = await getTherapistDocuments(req.user.id);

        res.status(200).json({
            success: true,
            data: result,
        });
    } catch (error) {
        next(error);
    }
}

/**
 * DELETE /api/therapist/onboarding/document/:documentId
 * Delete document (soft delete)
 */
export const deleteDocumentController = async (req, res, next) => {
    try {
        const { documentId } = req.params;

        const result = await deleteDocument(req.user.id, documentId);

        res.status(200).json({
            success: true,
            message: result.message
        });
    } catch (error) {
        next(error);
    }
}

// ─── Agency Onboarding Controllers ───────────────────────────────────────────

export const getAgencyOnboardingStatusController = async (req, res, next) => {
    try {
        const result = await getAgencyOnboardingStatus(req.user.id);
        res.status(200).json({ success: true, data: result });
    } catch (error) {
        next(error);
    }
};

export const getAgencyOnboardingDataController = async (req, res, next) => {
    try {
        const result = await getAgencyOnboardingData(req.user.id);
        res.status(200).json({ success: true, data: result });
    } catch (error) {
        next(error);
    }
};

export const saveAgencyBusinessProfileController = async (req, res, next) => {
    try {
        const { dbaName, ein, billingEmail, addressLine1, addressLine2, city, state, zipCode } = req.body;
        const result = await saveAgencyBusinessProfile(req.user.id, {
            dbaName,
            ein,
            billingEmail,
            addressLine1,
            addressLine2,
            city,
            state,
            zipCode,
        });
        res.status(200).json({ success: true, message: result.message, data: { customer: result.customer } });
    } catch (error) {
        next(error);
    }
};

/**
 * POST /api/agency/onboarding/upload-document
 * Upload a single agency onboarding document to the agency-documents bucket.
 */
export const uploadAgencyDocumentController = async (req, res, next) => {
    try {
        if (!req.file) throw new BadRequestError("No file uploaded");

        const result = await uploadAgencyDocument({
            userId: req.user.id,
            file: req.file,
            documentType: req.body.documentType,
            uploadIp: getClientIp(req),
        });

        res.status(201).json({ success: true, message: "Document uploaded successfully", data: result });
    } catch (error) {
        if (req.file) req.file.buffer = null;
        next(error);
    }
};

/**
 * POST /api/agency/onboarding/save-upload-documents
 * Reconcile agency upload documents and advance onboardingStep to 3.
 */
export const saveAgencyUploadDocumentsController = async (req, res, next) => {
    try {
        const { documents } = req.body;
        const result = await saveAgencyUploadDocuments(req.user.id, { documents });
        res.status(200).json({
            success: true,
            message: result.message,
            data: { customer: result.customer, documents: result.documents },
        });
    } catch (error) {
        next(error);
    }
};

/**
 * DELETE /api/agency/onboarding/document/:documentId
 * Soft-delete an agency onboarding document.
 */
export const deleteAgencyDocumentController = async (req, res, next) => {
    try {
        const result = await deleteAgencyDocument(req.user.id, req.params.documentId);
        res.status(200).json({ success: true, message: result.message });
    } catch (error) {
        next(error);
    }
};

/**
 * GET /api/agency/onboarding/compliance/content/:documentType
 * Return the rendered preview text for one agency compliance document.
 */
export const getAgencyComplianceContentController = async (req, res, next) => {
    try {
        const result = await getAgencyComplianceContent(req.user.id, req.params.documentType);
        res.status(200).json({ success: true, data: result });
    } catch (error) {
        next(error);
    }
};

/**
 * POST /api/agency/onboarding/compliance/sign
 * Record an agency's signature on a compliance document.
 */
export const signAgencyComplianceController = async (req, res, next) => {
    try {
        const { documentType, signature } = req.body;
        const result = await signAgencyComplianceDocument(req.user.id, { documentType, signature });
        res.status(200).json({ success: true, message: result.message, data: { customer: result.customer } });
    } catch (error) {
        next(error);
    }
};