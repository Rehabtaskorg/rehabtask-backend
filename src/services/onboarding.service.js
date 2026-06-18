import { APPROVAL_STATUS, BACKGROUND_CHECK_STATUS, TIME_MS } from "../utils/constants.js";
import { prisma, withAdminAccess } from "../config/prisma.js";
import { supabase, supabaseAdmin } from "../config/supabase.js";
import { NotFoundError, BadRequestError, ConflictError } from "../utils/errors.js";
import { sendTherapistApplicationSubmitted } from "./email.service.js";
import { geocodeZipCode, assertCoherenceOrLog } from "./geocoding.service.js";
import { deleteFileFromStorage } from "./upload.service.js";

/**
 * Get therapist onboarding status and progress
 */
export const getOnboardingStatus = async (userId) => {
    const therapist = await prisma.therapistProfile.findUnique({
        where: { userId },
        include: {
            licenseDocuments: {
                where: { isDeleted: false },
                orderBy: { uploadedAt: "desc" },
            },
            availability: true,
        }
    });

    if (!therapist) {
        throw new NotFoundError("Therapist profile not found");
    }

    // Determine which steps are complete
    const steps = {
        personalInfo: !!(
            therapist.dateOfBirth &&
            therapist.addressLine1 &&
            therapist.city &&
            therapist.state &&
            therapist.zipCode
        ),
        profile: !!(
            therapist.yearsOfExperience !== null &&
            therapist.primaryLicenseType &&
            therapist.professionalSummary
        ),
        credentials: !!(
            therapist.licenseNumber &&
            therapist.licenseState &&
            therapist.licenseDocuments.length > 0
        ),
        availability: therapist.availability.length > 0,
        backgroundCheck: !!(
            therapist.backgroundCheckConsent &&
            therapist.backgroundCheckSignature
        ),
        stripe: therapist.stripeOnboardingComplete,
    };

    const completedSteps = Object.values(steps).filter(Boolean).length;
    const totalSteps = 8;
    const progress = (completedSteps / totalSteps) * 100;

    return {
        therapist: {
            id: therapist.id,
            userId: therapist.userId,
            onboardingStep: therapist.onboardingStep,
            onboardingComplete: therapist.onboardingComplete,
            approvalStatus: therapist.approvalStatus
        },
        steps,
        progress,
        completedSteps,
        totalSteps,
    }
}

/**
 * Save personal information (Step 1)
 */
export const savePersonalInfo = async (userId, data) => {
    const therapist = await prisma.therapistProfile.findUnique({
        where: { userId },
    });

    if (!therapist) {
        throw new NotFoundError("Therapist profile not found");
    }

    const updated = await withAdminAccess(async (db) => {
        return db.therapistProfile.update({
            where: { userId },
            data: {
                dateOfBirth: data.dateOfBirth ? new Date(data.dateOfBirth) : undefined,
                phone: data.phone,
                addressLine1: data.addressLine1,
                addressLine2: data.addressLine2 ?? null,
                city: data.city,
                state: data.state,
                zipCode: data.zipCode,
                latitude: data.latitude ?? null,
                longitude: data.longitude ?? null,
                emergencyContactName: data.emergencyContactName ?? null,
                emergencyContactPhone: data.emergencyContactPhone ?? null,
                onboardingStep: Math.max(therapist.onboardingStep, 2),
            },
        });
    });

    return {
        message: "Personal information saved successfully",
        therapist: {
            id: updated.id,
            onboardingStep: updated.onboardingStep,
        },
    };
};

/**
 * Save professional profile (Step 2)
 */
export const saveProfessionalProfile = async (userId, data) => {
    const therapist = await prisma.therapistProfile.findUnique({
        where: { userId },
    });

    if (!therapist) {
        throw new NotFoundError("Therapist profile not found");
    }

    // Validate years of experience
    if (data.yearsOfExperience < 0 || data.yearsOfExperience > 50) {
        throw new BadRequestError("Years of experience must be between 0 and 50");
    }

    const updated = await withAdminAccess(async (db) => {
        return db.therapistProfile.update({
            where: { userId },
            data: {
                yearsOfExperience: data.yearsOfExperience,
                primaryLicenseType: data.primaryLicenseType,
                specialization: data.specialization,
                professionalSummary: data.professionalSummary,
                profilePhotoUrl: data.profilePhotoUrl || null,
                onboardingStep: Math.max(therapist.onboardingStep, 2),
            },
        });
    });

    return {
        message: "Professional profile saved successfully",
        therapist: {
            id: updated.id,
            onboardingStep: updated.onboardingStep,
        },
    };
};

/**
 * Save credentials (Step 2)
 */
export const saveCredentials = async (userId, data, uploadIp = null) => {
    const therapist = await prisma.therapistProfile.findUnique({
        where: { userId },
    });

    if (!therapist) {
        throw new NotFoundError("Therapist profile not found");
    }

    // Check if license number already exists (for another therapist)
    const existingLicense = await prisma.therapistProfile.findFirst({
        where: {
            licenseNumber: data.licenseNumber,
            userId: { not: userId }
        },
    });

    if (existingLicense) {
        throw new ConflictError("License number already registered");
    }

    // Rate limit check: Max 10 uploads per hour
    const oneHourAgo = new Date(Date.now() - TIME_MS.ONE_HOUR);
    const recentUploads = await prisma.licenseDocument.count({
        where: {
            userId,
            uploadedAt: { gte: oneHourAgo },
            isDeleted: false,
        }
    });

    if (recentUploads >= 10) {
        throw new BadRequestError("Upload rate limit exceeded. Please try again later.");
    }

    // Update therapist profile
    const updated = await withAdminAccess(async (db) => {
        return db.therapistProfile.update({
            where: { userId },
            data: {
                licenseNumber: data.licenseNumber,
                licenseState: data.licenseState,
                npiNumber: data.npiNumber ?? null,
                additionalLicenseStates: data.additionalLicenseStates ?? [],
                ...(data.ratePerVisit !== undefined && { ratePerVisit: data.ratePerVisit }),
                ...(data.attemptedVisitRate !== undefined && { attemptedVisitRate: data.attemptedVisitRate }),
                onboardingStep: Math.max(therapist.onboardingStep, 3),
            },
        });
    });

    // Reconcile documents: keep submitted ones, soft-delete any removed ones
    const submittedPaths = new Set(data.licenseDocuments.map(doc => doc.path));

    // Soft-delete active documents NOT in the submitted list (user removed them)
    await prisma.licenseDocument.updateMany({
        where: {
            therapistId: therapist.id,
            isDeleted: false,
            documentUrl: { notIn: [...submittedPaths] },
        },
        data: {
            isDeleted: true,
            deletedAt: new Date(),
        },
    });

    // Fetch the remaining active documents (already created during upload)
    const activeDocuments = await prisma.licenseDocument.findMany({
        where: {
            therapistId: therapist.id,
            isDeleted: false,
        },
        orderBy: { uploadedAt: "desc" },
    });

    return {
        message: "Credentials saved successfully",
        therapist: {
            id: updated.id,
            onboardingStep: updated.onboardingStep,
        },
        documents: activeDocuments.map(doc => ({
            id: doc.id,
            fileName: doc.fileName,
        })),
    };
};

/**
 * Save availability (Step 3)
 * 
 * Now also creates an initial WorkArea record from geocoded zip code data
 * sent by the FE. This ensures the therapist is searchable immediately after admin approval,
 * without needing to manually add work area via profile
 */
export const saveAvailability = async (userId, data) => {
    const therapist = await prisma.therapistProfile.findUnique({
        where: { userId },
    });

    if (!therapist) {
        throw new NotFoundError("Therapist profile not found");
    }

    // Delete existing availability
    await prisma.availability.deleteMany({
        where: { therapistId: therapist.id }
    });

    // Create new availability records
    const daysOfWeek = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

    const availabilityRecords = daysOfWeek
        .filter(day => data.schedule[day]?.enabled)
        .map(day => ({
            therapistId: therapist.id,
            dayOfWeek: day,
            isEnabled: true,
            timeBlocks: data.schedule[day].timeBlocks,
        }));

    if (availabilityRecords.length > 0) {
        await prisma.availability.createMany({
            data: availabilityRecords,
        });
    }

    if (data.workAreas && data.workAreas.length > 0) {
        const geocodedAreas = await Promise.all(
            data.workAreas.map(async (wa) => {
                // ZIP may be empty when therapist selects by city/address — skip geocode, trust frontend coordinates
                if (wa.zipCode) {
                    const geo = await geocodeZipCode(wa.zipCode);
                    assertCoherenceOrLog(`onboarding.workArea.${wa.zipCode}`, wa.latitude, wa.longitude, geo.latitude, geo.longitude, 10);
                    return {
                        therapistId: therapist.id,
                        zipCode: wa.zipCode,
                        city: geo.city,
                        state: geo.state,
                        latitude: geo.latitude,
                        longitude: geo.longitude,
                        radiusMiles: Math.min(Math.max(wa.radiusMiles || 25, 1), 100),
                    };
                }
                return {
                    therapistId: therapist.id,
                    zipCode: wa.zipCode || "",
                    city: wa.city,
                    state: wa.state,
                    latitude: wa.latitude,
                    longitude: wa.longitude,
                    radiusMiles: Math.min(Math.max(wa.radiusMiles || 25, 1), 100),
                };
            })
        );

        // Delete any existing work areas from previous onboarding attempts
        // to ensure idempotency (re-submitting step 3 replaces, not duplicates)
        await prisma.workArea.deleteMany({
            where: { therapistId: therapist.id }
        });

        await prisma.workArea.createMany({ data: geocodedAreas });
    }

    // Update therapist profile
    const updated = await withAdminAccess(async (db) => {
        return db.therapistProfile.update({
            where: { userId },
            data: {
                onboardingStep: Math.max(therapist.onboardingStep, 4)
            },
        });
    });

    return {
        message: "Availability saved successfully",
        therapist: {
            id: updated.id,
            onboardingStep: updated.onboardingStep,
        },
    };
};

/**
 * Submit background check consent (Step 4)
 */
export const submitBackgroundCheck = async (userId, data) => {
    const therapist = await prisma.therapistProfile.findUnique({
        where: { userId },
    });

    if (!therapist) {
        throw new NotFoundError("Therapist profile not found");
    }

    if (!data.consent) {
        throw new BadRequestError("Background check consent is required");
    }

    const updated = await withAdminAccess(async (db) => {
        return db.therapistProfile.update({
            where: { userId },
            data: {
                backgroundCheckConsent: data.consent,
                backgroundCheckSignature: data.signature,
                backgroundCheckDate: new Date(),
                backgroundCheckStatus: BACKGROUND_CHECK_STATUS.PENDING,
                onboardingStep: Math.max(therapist.onboardingStep, 5),
            },
        });
    });

    return {
        message: "Background check consent submitted successfully",
        therapist: {
            id: updated.id,
            onboardingStep: updated.onboardingStep
        },
    };
};

/**
 * Complete onboarding (after Stripe connection)
 */
export const completeOnboarding = async (userId) => {
    const therapist = await prisma.therapistProfile.findUnique({
        where: { userId },
        include: {
            licenseDocuments: {
                where: { isDeleted: false },
            },
            availability: true
        },
    });

    if (!therapist) {
        throw new NotFoundError("Therapist profile not found");
    }

    // Validate all required fields are present
    const isProfileComplete = !!(
        therapist.yearsOfExperience !== null &&
        therapist.primaryLicenseType &&
        therapist.professionalSummary
    );

    const isCredentialsComplete = !!(
        therapist.licenseNumber &&
        therapist.licenseState &&
        therapist.licenseDocuments.length > 0
    );

    const isAvailabilityComplete = therapist.availability.length > 0;

    const isBackgroundCheckComplete = !!(
        therapist.backgroundCheckConsent &&
        therapist.backgroundCheckSignature
    );

    if (!isProfileComplete || !isCredentialsComplete || !isAvailabilityComplete || !isBackgroundCheckComplete) {
        throw new BadRequestError("All onboarding steps must be completed");
    }


    // Only move to "review" if the therapist has not already been approved or rejected
    // An already-approved therapist connecting Stripe post-approval must NOT be sent back to review
    const alreadyDecided = ["approved", "rejected"].includes(therapist.approvalStatus);
    const wasAlreadyComplete = therapist.onboardingComplete;

    const updated = await withAdminAccess(async (db) => {
        return db.therapistProfile.update({
            where: { userId },
            data: {
                onboardingComplete: true,
                ...(!alreadyDecided && { approvalStatus: APPROVAL_STATUS.REVIEW }),
            },
            include: { user: { select: { email: true } } },
        });
    });

    // Notify therapist + admin only on first-time completion (not on Stripe re-calls)
    if (!wasAlreadyComplete) {
        sendTherapistApplicationSubmitted({ therapist: updated }).catch(() => { });
    }

    return {
        message: alreadyDecided
            ? "Stripe setup noted. Your approval status is unchanged."
            : "Onboarding completed successfully. Your profile is under review.",
        therapist: {
            id: updated.id,
            onboardingComplete: updated.onboardingComplete,
            approvalStatus: updated.approvalStatus,
        },
    };
};

/**
 * Generate signed URL for private document
 */
export const getDocumentSignedUrl = async (userId, documentId) => {
    const document = await prisma.licenseDocument.findUnique({
        where: { id: documentId },
        include: {
            therapist: true
        },
    });

    if (!document) {
        throw new NotFoundError("Document not found");
    }

    if (document.isDeleted) {
        throw new NotFoundError("Document has been deleted");
    }

    // Verify ownership
    if (document.userId !== userId && document.therapist.userId !== userId) {
        throw new BadRequestError("Not authorized to access this document");
    }

    // Generate signed URL (60 second expiry)
    const { data, error } = await supabaseAdmin.storage
        .from(document.bucket)
        .createSignedUrl(document.documentUrl, 60);

    if (error) {
        console.error("Supabase signed URL error:", error);
        throw new BadRequestError("Failed to generate document URL");
    }

    return {
        signedUrl: data.signedUrl,
        expiresIn: 60,
        fileName: document.fileName,
        fileSize: document.fileSize
    };
};

/**
 * Get all documents for a therapist
 */
export const getTherapistDocuments = async (userId) => {
    const therapist = await prisma.therapistProfile.findUnique({
        where: { userId },
    });

    if (!therapist) {
        throw new NotFoundError("Therapist profile not found");
    }

    const documents = await prisma.licenseDocument.findMany({
        where: {
            therapistId: therapist.id,
            isDeleted: false,
        },
        orderBy: { uploadedAt: "desc" },
        select: {
            id: true,
            fileName: true,
            fileSize: true,
            documentType: true,
            mimeType: true,
            status: true,
            uploadedAt: true,
            verifiedAt: true,
            reject_reason: true
        },
    });

    return { documents };
};

/**
 * Delete document — soft-deletes the DB row (preserves the audit trail) and
 * immediately removes the underlying Supabase Storage file. Removal happens
 * during onboarding, before the document is ever part of a submitted
 * application, so there's no retention reason to keep the storage object
 * around — leaving it behind only orphans it and leaks storage cost.
 */
export const deleteDocument = async (userId, documentId) => {
    const document = await prisma.licenseDocument.findUnique({
        where: { id: documentId },
    });

    if (!document) {
        throw new NotFoundError("Document not found");
    }

    if (document.userId !== userId) {
        throw new BadRequestError("Not authorized to delete this document");
    }

    if (document.isDeleted) {
        throw new BadRequestError("Document already deleted");
    }

    // Soft delete the row first — if storage removal fails below, the
    // document is still correctly hidden from the user's active list.
    await prisma.licenseDocument.update({
        where: { id: documentId },
        data: {
            isDeleted: true,
            deletedAt: new Date(),
        },
    });

    await deleteFileFromStorage(document.bucket || "license-documents", document.documentUrl);

    return {
        message: "Document deleted successfully",
    };
};