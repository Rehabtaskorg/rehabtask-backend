import { prisma, withAdminAccess } from "../config/prisma.js";
import { supabase, supabaseAdmin } from "../config/supabase.js";
import { NotFoundError, BadRequestError, ConflictError } from "../utils/errors.js";

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
        profile: !!(
            therapist.yearsOfExperience !== null &&
            therapist.primaryLicenseType &&
            therapist.specialization &&
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
    const progress = (completedSteps / 5) * 100;

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
        totalSteps: 5
    }
}

/**
 * Save professional profile (Step 1)
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
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
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
                onboardingStep: Math.max(therapist.onboardingStep, 3),
            },
        });
    });

    // Soft delete existing documents (don't actually delete from storage)
    await prisma.licenseDocument.updateMany({
        where: {
            therapistId: therapist.id,
            isDeleted: false
        },
        data: {
            isDeleted: true,
            deletedAt: new Date(),
        },
    });

    // Create new license document records
    const documentRecords = await Promise.all(
        data.licenseDocuments.map(async (doc) => {
            return prisma.licenseDocument.create({
                data: {
                    therapistId: therapist.id,
                    userId: userId,
                    documentUrl: doc.path,
                    bucket: "license-documents",
                    documentType: doc.documentType,
                    fileName: doc.fileName,
                    fileSize: doc.fileSize,
                    mimeType: doc.mimetype || "application/pdf",
                    status: "pending",
                    uploadIp: uploadIp,
                },
            });
        })
    );

    return {
        message: "Credentials saved successfully",
        therapist: {
            id: updated.id,
            onboardingStep: updated.onboardingStep,
        },
        documents: documentRecords.map(doc => ({
            id: doc.id,
            fileName: doc.fileName,
            status: doc.status
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

    // Create initial Work area from geocoded zip code (if provided)
    if (data.workArea && data.workArea.latitude && data.workArea.longitude) {
        // Delete any existing work areas from previous onboarding attempts
        // to ensure idempotency (re-submitting step 3 replaces, not duplicates)
        await prisma.workArea.deleteMany({
            where: { therapistId: therapist.id }
        });

        await prisma.workArea.create({
            data: {
                therapistId: therapist.id,
                city: data.workArea.city,
                state: data.workArea.state,
                latitude: data.workArea.latitude,
                longitude: data.workArea.longitude,
                radiusMiles: Math.min(Math.max(data.workArea.radiusMiles || 25, 1), 100)
            },
        });
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
                backgroundCheckStatus: "pending",
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
        therapist.specialization &&
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

    // Mark onboarding as complete and set status to review
    const updated = await withAdminAccess(async (db) => {
        return db.therapistProfile.update({
            where: { userId },
            data: {
                onboardingComplete: true,
                approvalStatus: "review"
            },
        });
    });

    return {
        message: "Onboarding completed successfully. Your profile is under review.",
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
 * Delete document (soft delete)
 */
export const deleteDocument = async (userId, documentId) => {
    const document = await prisma.licenseDocument.findUnique({
        where: { id: documentId },
    });

    if (!document) {
        throw new NotFoundError("Document not found");
    }

    // Verify ownership
    if (document.userId !== userId) {
        throw new BadRequestError("Not authorized to delete this document");
    }

    // Already deleted
    if (document.isDeleted) {
        throw new BadRequestError("Document already deleted");
    }

    // Soft delete
    await prisma.licenseDocument.update({
        where: { id: documentId },
        data: {
            isDeleted: true,
            deletedAt: new Date(),
        },
    });

    return {
        message: "Document deleted successfully",
    };
};