import {
    completeOnboarding,
    deleteDocument,
    getDocumentSignedUrl,
    getOnboardingStatus,
    getTherapistDocuments,
    saveAvailability,
    saveCredentials,
    saveProfessionalProfile,
    submitBackgroundCheck

} from "../services/onboarding.service";

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
 * POST /api/therapist/onboarding/profile
 * Save professional profile (Step 1)
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
        const { licenseNumber, licenseState, licenseDocuments } = req.body;
        const uploadIp = getClientIp(req);

        const result = await saveCredentials(req.user.id,
            {
                licenseNumber,
                licenseState,
                licenseDocuments
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
        const { schedule, acceptingNewPatients, baseZipCode, serviceRadiusMiles } = req.body;

        const result = await saveAvailability(req.user.id, {
            schedule,
            acceptingNewPatients,
            baseZipCode,
            serviceRadiusMiles
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

/**
 * POST /api/therapist/onboarding/validate-upload
 * Validate file upload metadata
 */
export const validateFileUploadController = async (req, res, next) => {
    try {
        const { path, fileName, fileSize, mimeType, bucket } = req.body;
        const uploadIp = getClientIp(req);

        // Validation is already done by Zod schema in validation middleware

        res.status(200).json({
            success: true,
            message: "File upload validated",
            data: {
                path,
                fileName,
                fileSize,
                mimeType,
                bucket,
                uploadIp
            },
        });
    } catch (error) {
        next(error);
    }
}