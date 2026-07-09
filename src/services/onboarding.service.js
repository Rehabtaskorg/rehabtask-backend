import { APPROVAL_STATUS, BACKGROUND_CHECK_STATUS, TIME_MS, DOCUMENT_CATEGORIES, COMPLIANCE_DOCUMENT_TYPES, AGENCY_DOCUMENTS_BUCKET, INDIVIDUAL_DOCUMENTS_BUCKET, INDIVIDUAL_CONSENT_DOCUMENT_TYPES } from "../utils/constants.js";
import { prisma, withAdminAccess } from "../config/prisma.js";
import { NotFoundError, BadRequestError, ConflictError } from "../utils/errors.js";
import { logger } from "../config/logger.js";
import { sendTherapistApplicationSubmitted } from "./email.service.js";
import { geocodeZipCode, assertCoherenceOrLog } from "./geocoding.service.js";
import { deleteFileFromStorage } from "./upload.service.js";
import { getSignedUrl } from "./storage.service.js";
import {
    renderIndependentContractorAgreement,
    renderHipaaAcknowledgment,
    renderBackgroundCheckAuthorization,
    renderSignedDocument,
    renderAgencyServiceAgreement,
    renderAgencyHipaaBaa,
    renderSignedAgencyDocument,
    renderIndividualHipaaConsent,
    renderIndividualTreatmentConsent,
    renderSignedIndividualConsentDocument,
} from "../data/complianceTemplates.js";

const computeOnboardingSteps = (therapist) => {
    const hasDocumentType = (types) =>
        therapist.licenseDocuments.some((doc) => types.includes(doc.documentType));

    const hasSignedDocument = (documentType) =>
        therapist.complianceSignatures.some((s) => s.documentType === documentType);

    return {
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
            hasDocumentType(DOCUMENT_CATEGORIES.license)
        ),
        availability: therapist.availability.length > 0,
        insurance: !!(
            hasDocumentType(["general_liability"]) &&
            hasDocumentType(["professional_liability"]) &&
            (!therapist.doesHomeVisits || hasDocumentType(["auto_insurance"]))
        ),
        identity: hasDocumentType(["government_id_front"]),
        compliance: !!(
            hasDocumentType(DOCUMENT_CATEGORIES.compliance) &&
            hasSignedDocument(COMPLIANCE_DOCUMENT_TYPES.INDEPENDENT_CONTRACTOR_AGREEMENT) &&
            hasSignedDocument(COMPLIANCE_DOCUMENT_TYPES.HIPAA_ACKNOWLEDGMENT) &&
            hasSignedDocument(COMPLIANCE_DOCUMENT_TYPES.BACKGROUND_CHECK_AUTHORIZATION)
        ),
    };
};


export const getOnboardingStatus = async (userId) => {
    const therapist = await prisma.therapistProfile.findUnique({
        where: { userId },
        include: {
            licenseDocuments: {
                where: { isDeleted: false },
                orderBy: { uploadedAt: "desc" },
            },
            availability: true,
            complianceSignatures: true,
        }
    });

    if (!therapist) {
        throw new NotFoundError("Therapist profile not found");
    }

    const steps = {
        ...computeOnboardingSteps(therapist),
        stripe: therapist.stripeOnboardingComplete,
    };

    const completedSteps = Object.values(steps).filter(Boolean).length;
    const totalSteps = Object.keys(steps).length;
    const progress = Math.round((completedSteps / totalSteps) * 100);

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

export const getOnboardingData = async (userId) => {
    const therapist = await prisma.therapistProfile.findUnique({
        where: { userId },
        include: {
            licenseDocuments: {
                where: { isDeleted: false },
                orderBy: { uploadedAt: "desc" },
            },
            availability: true,
            workAreas: true,
        },
    });

    if (!therapist) {
        throw new NotFoundError("Therapist profile not found");
    }

    const documentsByCategory = (types) =>
        therapist.licenseDocuments
            .filter((doc) => types.includes(doc.documentType))
            .map((doc) => ({
                id: doc.id,
                path: doc.documentUrl,
                fileName: doc.fileName,
                fileSize: doc.fileSize,
                documentType: doc.documentType,
                mimeType: doc.mimeType,
            }));

    const daysOfWeek = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
    const scheduleByDay = therapist.availability.reduce((acc, day) => {
        acc[day.dayOfWeek] = { enabled: day.isEnabled, timeBlocks: day.timeBlocks };
        return acc;
    }, {});
    const schedule = daysOfWeek.reduce((acc, day) => {
        acc[day] = scheduleByDay[day] ?? { enabled: false, timeBlocks: [] };
        return acc;
    }, {});

    const toNumberOrNull = (value) => (value === null || value === undefined ? null : parseFloat(value));

    return {
        personalInfo: {
            dateOfBirth: therapist.dateOfBirth,
            phone: therapist.phone,
            addressLine1: therapist.addressLine1,
            addressLine2: therapist.addressLine2,
            city: therapist.city,
            state: therapist.state,
            zipCode: therapist.zipCode,
            latitude: toNumberOrNull(therapist.latitude),
            longitude: toNumberOrNull(therapist.longitude),
            emergencyContactName: therapist.emergencyContactName,
            emergencyContactPhone: therapist.emergencyContactPhone,
        },
        professionalProfile: {
            yearsOfExperience: therapist.yearsOfExperience,
            primaryLicenseType: therapist.primaryLicenseType,
            specialization: therapist.specialization,
            professionalSummary: therapist.professionalSummary,
            profilePhotoUrl: therapist.profilePhotoUrl,
        },
        credentials: {
            licenseNumber: therapist.licenseNumber,
            licenseState: therapist.licenseState,
            npiNumber: therapist.npiNumber,
            additionalLicenseStates: therapist.additionalLicenseStates,
            ratePerVisit: toNumberOrNull(therapist.ratePerVisit),
            attemptedVisitRate: toNumberOrNull(therapist.attemptedVisitRate),
            licenseDocuments: documentsByCategory(DOCUMENT_CATEGORIES.license),
        },
        availability: {
            schedule,
            workAreas: therapist.workAreas.map((wa) => ({
                zipCode: wa.zipCode,
                city: wa.city,
                state: wa.state,
                latitude: toNumberOrNull(wa.latitude),
                longitude: toNumberOrNull(wa.longitude),
                radiusMiles: wa.radiusMiles,
            })),
        },
        insurance: {
            doesHomeVisits: therapist.doesHomeVisits,
            documents: documentsByCategory(DOCUMENT_CATEGORIES.insurance),
        },
        identity: {
            documents: documentsByCategory(DOCUMENT_CATEGORIES.identity),
        },
    };
};


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
                onboardingStep: Math.max(therapist.onboardingStep, 3),
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

    // Check if NPI number already exists (for another therapist)
    if (data.npiNumber) {
        const existingNpi = await prisma.therapistProfile.findFirst({
            where: {
                npiNumber: data.npiNumber,
                userId: { not: userId }
            },
        });

        if (existingNpi) {
            throw new ConflictError("NPI number already registered");
        }
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
                onboardingStep: Math.max(therapist.onboardingStep, 4),
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
                onboardingStep: Math.max(therapist.onboardingStep, 5)
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


export const saveInsurance = async (userId, data) => {
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
                doesHomeVisits: data.doesHomeVisits,
                onboardingStep: Math.max(therapist.onboardingStep, 6),
            },
        });
    });

    const submittedPaths = new Set(data.documents.map((doc) => doc.path));

    await prisma.licenseDocument.updateMany({
        where: {
            therapistId: therapist.id,
            isDeleted: false,
            documentType: { in: DOCUMENT_CATEGORIES.insurance },
            documentUrl: { notIn: [...submittedPaths] },
        },
        data: {
            isDeleted: true,
            deletedAt: new Date(),
        },
    });

    const activeDocuments = await prisma.licenseDocument.findMany({
        where: {
            therapistId: therapist.id,
            isDeleted: false,
            documentType: { in: DOCUMENT_CATEGORIES.insurance },
        },
        orderBy: { uploadedAt: "desc" },
    });

    return {
        message: "Insurance documentation saved successfully",
        therapist: {
            id: updated.id,
            onboardingStep: updated.onboardingStep,
        },
        documents: activeDocuments.map((doc) => ({
            id: doc.id,
            fileName: doc.fileName,
            documentType: doc.documentType,
        })),
    };
};


export const saveIdentityVerification = async (userId, data) => {
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
                onboardingStep: Math.max(therapist.onboardingStep, 7),
            },
        });
    });

    const submittedPaths = new Set(data.documents.map((doc) => doc.path));

    await prisma.licenseDocument.updateMany({
        where: {
            therapistId: therapist.id,
            isDeleted: false,
            documentType: { in: DOCUMENT_CATEGORIES.identity },
            documentUrl: { notIn: [...submittedPaths] },
        },
        data: {
            isDeleted: true,
            deletedAt: new Date(),
        },
    });

    const activeDocuments = await prisma.licenseDocument.findMany({
        where: {
            therapistId: therapist.id,
            isDeleted: false,
            documentType: { in: DOCUMENT_CATEGORIES.identity },
        },
        orderBy: { uploadedAt: "desc" },
    });

    return {
        message: "Identity verification documents saved successfully",
        therapist: {
            id: updated.id,
            onboardingStep: updated.onboardingStep,
        },
        documents: activeDocuments.map((doc) => ({
            id: doc.id,
            fileName: doc.fileName,
            documentType: doc.documentType,
        })),
    };
};


export const getComplianceContent = async (userId) => {
    const therapist = await prisma.therapistProfile.findUnique({
        where: { userId },
        include: {
            licenseDocuments: { where: { isDeleted: false } },
            complianceSignatures: true,
        },
    });

    if (!therapist) {
        throw new NotFoundError("Therapist profile not found");
    }

    const signedDocumentTypes = new Set(therapist.complianceSignatures.map((s) => s.documentType));
    const hasW9 = therapist.licenseDocuments.some((doc) => DOCUMENT_CATEGORIES.compliance.includes(doc.documentType));

    return {
        independentContractorAgreement: renderIndependentContractorAgreement(therapist),
        hipaaAcknowledgment: renderHipaaAcknowledgment(therapist),
        backgroundCheckAuthorization: renderBackgroundCheckAuthorization(therapist),
        w9: {
            uploaded: hasW9,
            documents: therapist.licenseDocuments
                .filter((doc) => DOCUMENT_CATEGORIES.compliance.includes(doc.documentType))
                .map((doc) => ({
                    id: doc.id,
                    path: doc.documentUrl,
                    fileName: doc.fileName,
                    fileSize: doc.fileSize,
                    documentType: doc.documentType,
                    mimeType: doc.mimeType,
                })),
        },
        signed: {
            [COMPLIANCE_DOCUMENT_TYPES.INDEPENDENT_CONTRACTOR_AGREEMENT]:
                signedDocumentTypes.has(COMPLIANCE_DOCUMENT_TYPES.INDEPENDENT_CONTRACTOR_AGREEMENT),
            [COMPLIANCE_DOCUMENT_TYPES.HIPAA_ACKNOWLEDGMENT]:
                signedDocumentTypes.has(COMPLIANCE_DOCUMENT_TYPES.HIPAA_ACKNOWLEDGMENT),
            [COMPLIANCE_DOCUMENT_TYPES.BACKGROUND_CHECK_AUTHORIZATION]:
                signedDocumentTypes.has(COMPLIANCE_DOCUMENT_TYPES.BACKGROUND_CHECK_AUTHORIZATION),
        },
    };
};

export const signComplianceDocument = async (userId, { documentType, signature }) => {
    const therapist = await prisma.therapistProfile.findUnique({
        where: { userId },
        include: { licenseDocuments: { where: { isDeleted: false } } },
    });

    if (!therapist) {
        throw new NotFoundError("Therapist profile not found");
    }

    const signedText = renderSignedDocument(documentType, therapist, signature);

    const existing = await prisma.complianceSignature.findFirst({
        where: { therapistId: therapist.id, documentType },
    });

    if (existing) {
        await prisma.complianceSignature.update({
            where: { id: existing.id },
            data: { signature, signedText, signedAt: new Date() },
        });
    } else {
        await prisma.complianceSignature.create({
            data: { therapistId: therapist.id, documentType, signature, signedText },
        });
    }

    const allSignatures = await prisma.complianceSignature.findMany({
        where: { therapistId: therapist.id },
    });
    const signedTypes = new Set(allSignatures.map((s) => s.documentType));
    const hasW9 = therapist.licenseDocuments.some((doc) => DOCUMENT_CATEGORIES.compliance.includes(doc.documentType));

    const complianceComplete = hasW9
        && signedTypes.has(COMPLIANCE_DOCUMENT_TYPES.INDEPENDENT_CONTRACTOR_AGREEMENT)
        && signedTypes.has(COMPLIANCE_DOCUMENT_TYPES.HIPAA_ACKNOWLEDGMENT)
        && signedTypes.has(COMPLIANCE_DOCUMENT_TYPES.BACKGROUND_CHECK_AUTHORIZATION);

    const updated = await withAdminAccess(async (db) => {
        return db.therapistProfile.update({
            where: { userId },
            data: complianceComplete ? { onboardingStep: Math.max(therapist.onboardingStep, 8) } : {},
        });
    });

    return {
        message: "Document signed successfully",
        therapist: {
            id: updated.id,
            onboardingStep: updated.onboardingStep,
        },
    };
};


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


export const advanceToFinalReview = async (userId) => {
    const therapist = await prisma.therapistProfile.findUnique({
        where: { userId },
    });

    if (!therapist) {
        throw new NotFoundError("Therapist profile not found");
    }

    const updated = await withAdminAccess(async (db) => {
        return db.therapistProfile.update({
            where: { userId },
            data: { onboardingStep: Math.max(therapist.onboardingStep, 9) },
        });
    });

    return {
        message: "Advanced to final review",
        therapist: {
            id: updated.id,
            onboardingStep: updated.onboardingStep,
        },
    };
};


export const completeOnboarding = async (userId) => {
    const therapist = await prisma.therapistProfile.findUnique({
        where: { userId },
        include: {
            licenseDocuments: {
                where: { isDeleted: false },
            },
            availability: true,
            complianceSignatures: true,
        },
    });

    if (!therapist) {
        throw new NotFoundError("Therapist profile not found");
    }

    const steps = computeOnboardingSteps(therapist);
    const incompleteSteps = Object.entries(steps)
        .filter(([, isComplete]) => !isComplete)
        .map(([step]) => step);

    if (incompleteSteps.length > 0) {
        throw new BadRequestError(`All onboarding steps must be completed: ${incompleteSteps.join(", ")}`);
    }


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
    const { signedUrl } = await getSignedUrl(document.bucket, document.documentUrl, 60);

    return {
        signedUrl,
        expiresIn: 60,
        fileName: document.fileName,
        fileSize: document.fileSize,
    };
};

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


export const getAgencyOnboardingStatus = async (userId) => {
    const customer = await prisma.customerProfile.findUnique({
        where: { userId },
        include: {
            agencyLicenseDocuments: { where: { isDeleted: false } },
            agencyComplianceSignatures: true,
        },
    });

    if (!customer) throw new NotFoundError("Customer profile not found");

    const REQUIRED_AGENCY_DOC_TYPES = ["home_health_license", "general_liability", "professional_liability"];
    const uploadedTypes = new Set(customer.agencyLicenseDocuments.map((d) => d.documentType));
    const hasRequiredDocs = REQUIRED_AGENCY_DOC_TYPES.every((t) => uploadedTypes.has(t));

    const signedTypes = new Set(customer.agencyComplianceSignatures.map((s) => s.documentType));
    const hasW9 = customer.agencyLicenseDocuments.some((d) => d.documentType === "w9");
    const complianceForms = hasW9
        && signedTypes.has(COMPLIANCE_DOCUMENT_TYPES.SERVICE_AGREEMENT)
        && signedTypes.has(COMPLIANCE_DOCUMENT_TYPES.HIPAA_BAA);

    const steps = {
        businessProfile: !!(
            customer.billingEmail &&
            customer.addressLine1 &&
            customer.city &&
            customer.state &&
            customer.zipCode
        ),
        uploadDocuments: hasRequiredDocs,
        complianceForms,
    };

    const completedSteps = Object.values(steps).filter(Boolean).length;
    const totalSteps = Object.keys(steps).length;
    const progress = Math.round((completedSteps / totalSteps) * 100);

    return {
        customer: {
            id: customer.id,
            onboardingStep: customer.onboardingStep,
            onboardingComplete: customer.onboardingComplete,
            approvalStatus: customer.approvalStatus,
        },
        steps,
        progress,
        completedSteps,
        totalSteps,
    };
};

export const getAgencyOnboardingData = async (userId) => {
    const customer = await prisma.customerProfile.findUnique({
        where: { userId },
        include: { user: { select: { email: true } } },
    });

    if (!customer) throw new NotFoundError("Customer profile not found");

    return {
        registration: {
            agencyName: customer.agencyName,
            fullName: customer.fullName,
            phone: customer.phone,
            email: customer.user.email,
        },
        businessProfile: {
            dbaName: customer.dbaName,
            ein: customer.ein,
            billingEmail: customer.billingEmail,
            addressLine1: customer.addressLine1,
            addressLine2: customer.addressLine2,
            city: customer.city,
            state: customer.state,
            zipCode: customer.zipCode,
        },
    };
};

export const saveAgencyBusinessProfile = async (userId, data) => {
    const customer = await prisma.customerProfile.findUnique({
        where: { userId },
    });

    if (!customer) throw new NotFoundError("Customer profile not found");

    const updated = await withAdminAccess(async (db) => {
        return db.customerProfile.update({
            where: { userId },
            data: {
                dbaName: data.dbaName ?? null,
                ein: data.ein ?? null,
                billingEmail: data.billingEmail,
                addressLine1: data.addressLine1,
                addressLine2: data.addressLine2 ?? null,
                city: data.city,
                state: data.state,
                zipCode: data.zipCode,
                onboardingStep: Math.max(customer.onboardingStep, 2),
            },
        });
    });

    return {
        message: "Business profile saved successfully",
        customer: {
            id: updated.id,
            onboardingStep: updated.onboardingStep,
        },
    };
};


export const saveAgencyUploadDocuments = async (userId, data) => {
    const customer = await prisma.customerProfile.findUnique({
        where: { userId },
    });

    if (!customer) throw new NotFoundError("Customer profile not found");

    const REQUIRED_TYPES = ["home_health_license", "general_liability", "professional_liability"];
    const submittedTypes = data.documents.map((d) => d.documentType);
    const missingRequired = REQUIRED_TYPES.filter((t) => !submittedTypes.includes(t));

    if (missingRequired.length > 0) {
        throw new BadRequestError(
            `Missing required documents: ${missingRequired.join(", ")}`
        );
    }

    const submittedPaths = new Set(data.documents.map((d) => d.path));

    await prisma.licenseDocument.updateMany({
        where: {
            agencyId: customer.id,
            isDeleted: false,
            documentType: { in: DOCUMENT_CATEGORIES.agency },
            documentUrl: { notIn: [...submittedPaths] },
        },
        data: { isDeleted: true, deletedAt: new Date() },
    });

    const updated = await withAdminAccess(async (db) => {
        return db.customerProfile.update({
            where: { userId },
            data: { onboardingStep: Math.max(customer.onboardingStep, 3) },
        });
    });

    const activeDocuments = await prisma.licenseDocument.findMany({
        where: {
            agencyId: customer.id,
            isDeleted: false,
            documentType: { in: DOCUMENT_CATEGORIES.agency },
        },
        orderBy: { uploadedAt: "desc" },
    });

    return {
        message: "Upload documents saved successfully",
        customer: { id: updated.id, onboardingStep: updated.onboardingStep },
        documents: activeDocuments.map((d) => ({ id: d.id, fileName: d.fileName, documentType: d.documentType })),
    };
};


export const deleteAgencyDocument = async (userId, documentId) => {
    const document = await prisma.licenseDocument.findUnique({
        where: { id: documentId },
    });

    if (!document) throw new NotFoundError("Document not found");
    if (document.isDeleted) throw new BadRequestError("Document already deleted");

    const customer = await prisma.customerProfile.findUnique({ where: { userId } });

    if (!customer || document.agencyId !== customer.id) {
        throw new BadRequestError("Not authorized to delete this document");
    }

    await prisma.licenseDocument.update({
        where: { id: documentId },
        data: { isDeleted: true, deletedAt: new Date() },
    });

    await deleteFileFromStorage(document.bucket || AGENCY_DOCUMENTS_BUCKET, document.documentUrl);

    return { message: "Document deleted successfully" };
};


export const getAgencyComplianceContent = async (userId, documentType) => {
    const ALLOWED = [COMPLIANCE_DOCUMENT_TYPES.SERVICE_AGREEMENT, COMPLIANCE_DOCUMENT_TYPES.HIPAA_BAA];
    if (!ALLOWED.includes(documentType)) {
        throw new BadRequestError(`Unknown agency compliance document type: ${documentType}`);
    }

    const customer = await prisma.customerProfile.findUnique({ where: { userId } });
    if (!customer) throw new NotFoundError("Customer profile not found");

    const content = documentType === COMPLIANCE_DOCUMENT_TYPES.SERVICE_AGREEMENT
        ? renderAgencyServiceAgreement(customer)
        : renderAgencyHipaaBaa(customer);

    return { documentType, content };
};


export const signAgencyComplianceDocument = async (userId, { documentType, signature }) => {
    const ALLOWED = [COMPLIANCE_DOCUMENT_TYPES.SERVICE_AGREEMENT, COMPLIANCE_DOCUMENT_TYPES.HIPAA_BAA];
    if (!ALLOWED.includes(documentType)) {
        throw new BadRequestError(`Unknown agency compliance document type: ${documentType}`);
    }

    const customer = await prisma.customerProfile.findUnique({
        where: { userId },
        include: { agencyLicenseDocuments: { where: { isDeleted: false } } },
    });

    if (!customer) throw new NotFoundError("Customer profile not found");

    const signedText = renderSignedAgencyDocument(documentType, customer, signature);

    // Cannot use prisma upsert — the unique constraint is a raw partial index not
    // reflected in schema.prisma, so Prisma has no named constraint to target.
    const existing = await prisma.complianceSignature.findFirst({
        where: { agencyId: customer.id, documentType },
    });

    if (existing) {
        await prisma.complianceSignature.update({
            where: { id: existing.id },
            data: { signature, signedText, signedAt: new Date() },
        });
    } else {
        await prisma.complianceSignature.create({
            data: { agencyId: customer.id, documentType, signature, signedText },
        });
    }

    const allSigs = await prisma.complianceSignature.findMany({
        where: { agencyId: customer.id },
    });
    const signedTypes = new Set(allSigs.map((s) => s.documentType));
    const hasW9 = customer.agencyLicenseDocuments.some((d) => d.documentType === "w9");

    const complianceComplete = hasW9
        && signedTypes.has(COMPLIANCE_DOCUMENT_TYPES.SERVICE_AGREEMENT)
        && signedTypes.has(COMPLIANCE_DOCUMENT_TYPES.HIPAA_BAA);

    const updated = await withAdminAccess(async (db) => {
        return db.customerProfile.update({
            where: { userId },
            data: complianceComplete ? { onboardingStep: Math.max(customer.onboardingStep, 4) } : {},
        });
    });

    return {
        message: "Document signed successfully",
        customer: { id: updated.id, onboardingStep: updated.onboardingStep },
    };
};


export const completeAgencyOnboarding = async (userId) => {
    const customer = await prisma.customerProfile.findUnique({
        where: { userId },
        include: {
            agencyLicenseDocuments: { where: { isDeleted: false } },
            agencyComplianceSignatures: true,
        },
    });

    if (!customer) throw new NotFoundError("Customer profile not found");

    // Guard: all prerequisite steps must be complete before we seal the record.
    const REQUIRED_DOC_TYPES = ["home_health_license", "general_liability", "professional_liability"];
    const uploadedTypes = new Set(customer.agencyLicenseDocuments.map((d) => d.documentType));
    const hasRequiredDocs = REQUIRED_DOC_TYPES.every((t) => uploadedTypes.has(t));
    const hasW9 = customer.agencyLicenseDocuments.some((d) => d.documentType === "w9");
    const signedTypes = new Set(customer.agencyComplianceSignatures.map((s) => s.documentType));
    const hasServiceAgreement = signedTypes.has(COMPLIANCE_DOCUMENT_TYPES.SERVICE_AGREEMENT);
    const hasHipaaBaa = signedTypes.has(COMPLIANCE_DOCUMENT_TYPES.HIPAA_BAA);
    const hasBusinessProfile = !!(
        customer.billingEmail &&
        customer.addressLine1 &&
        customer.city &&
        customer.state &&
        customer.zipCode
    );

    const incompleteSteps = [
        !hasBusinessProfile && "businessProfile",
        !hasRequiredDocs && "uploadDocuments",
        !hasW9 && "w9",
        !hasServiceAgreement && "serviceAgreement",
        !hasHipaaBaa && "hipaaBaa",
    ].filter(Boolean);

    if (incompleteSteps.length > 0) {
        throw new BadRequestError(
            `All onboarding steps must be completed before activation: ${incompleteSteps.join(", ")}`
        );
    }

    if (customer.onboardingComplete) {
        return {
            message: "Agency onboarding already complete.",
            customer: {
                id: customer.id,
                onboardingComplete: customer.onboardingComplete,
                approvalStatus: customer.approvalStatus,
            },
        };
    }

    const updated = await withAdminAccess(async (db) => {
        return db.customerProfile.update({
            where: { userId },
            data: {
                onboardingComplete: true,
                onboardingStep: 5,
                approvalStatus: APPROVAL_STATUS.APPROVED,
            },
        });
    });

    return {
        message: "Agency onboarding completed. Your account is now active.",
        customer: {
            id: updated.id,
            onboardingComplete: updated.onboardingComplete,
            approvalStatus: updated.approvalStatus,
        },
    };
};

export const getIndividualOnboardingStatus = async (userId) => {
    const customer = await prisma.customerProfile.findUnique({
        where: { userId },
        include: {
            customerConsentSignatures: true,
            customerLicenseDocuments: { where: { isDeleted: false } },
        },
    });

    if (!customer) throw new NotFoundError("Customer profile not found");

    const signedTypes = new Set(customer.customerConsentSignatures.map((s) => s.documentType));

    const steps = {
        personalInfo: !!(
            customer.dateOfBirth &&
            customer.addressLine1 &&
            customer.city &&
            customer.state &&
            customer.zipCode
        ),
        medicalInfo: !!customer.primaryDiagnosis,
        consentForms:
            signedTypes.has(INDIVIDUAL_CONSENT_DOCUMENT_TYPES.HIPAA_CONSENT) &&
            signedTypes.has(INDIVIDUAL_CONSENT_DOCUMENT_TYPES.TREATMENT_CONSENT),
    };

    const completedSteps = Object.values(steps).filter(Boolean).length;
    const totalSteps = Object.keys(steps).length;
    const progress = Math.round((completedSteps / totalSteps) * 100);

    return {
        customer: {
            id: customer.id,
            onboardingStep: customer.onboardingStep,
            onboardingComplete: customer.onboardingComplete,
            approvalStatus: customer.approvalStatus,
        },
        steps,
        progress,
        completedSteps,
        totalSteps,
    };
};

export const getIndividualOnboardingData = async (userId) => {
    const customer = await prisma.customerProfile.findUnique({
        where: { userId },
        include: {
            user: { select: { email: true } },
            customerLicenseDocuments: { where: { isDeleted: false } },
        },
    });

    if (!customer) throw new NotFoundError("Customer profile not found");

    const therapyOrderDoc = customer.customerLicenseDocuments.find(
        (d) => d.documentType === "therapy_order"
    );

    return {
        registration: {
            fullName: customer.fullName,
            phone: customer.phone,
            email: customer.user.email,
        },
        personalInfo: {
            dateOfBirth: customer.dateOfBirth ? customer.dateOfBirth.toISOString().split("T")[0] : null,
            addressLine1: customer.addressLine1,
            addressLine2: customer.addressLine2,
            city: customer.city,
            state: customer.state,
            zipCode: customer.zipCode,
        },
        medicalInfo: {
            primaryDiagnosis: customer.primaryDiagnosis,
            referringProviderName: customer.referringProviderName,
        },
        therapyOrderDocument: therapyOrderDoc
            ? {
                id: therapyOrderDoc.id,
                path: therapyOrderDoc.documentUrl,
                fileName: therapyOrderDoc.fileName,
                fileSize: therapyOrderDoc.fileSize,
                mimeType: therapyOrderDoc.mimeType,
                documentType: therapyOrderDoc.documentType,
            }
            : null,
    };
};

export const saveIndividualPersonalInfo = async (userId, data) => {
    const customer = await prisma.customerProfile.findUnique({ where: { userId } });
    if (!customer) throw new NotFoundError("Customer profile not found");

    const updated = await withAdminAccess(async (db) => {
        return db.customerProfile.update({
            where: { userId },
            data: {
                dateOfBirth: new Date(data.dateOfBirth),
                addressLine1: data.addressLine1,
                addressLine2: data.addressLine2 ?? null,
                city: data.city,
                state: data.state,
                zipCode: data.zipCode,
                onboardingStep: Math.max(customer.onboardingStep, 2),
            },
        });
    });

    return {
        message: "Personal information saved successfully",
        customer: { id: updated.id, onboardingStep: updated.onboardingStep },
    };
};

export const saveIndividualMedicalInfo = async (userId, data) => {
    const customer = await prisma.customerProfile.findUnique({ where: { userId } });
    if (!customer) throw new NotFoundError("Customer profile not found");

    const updated = await withAdminAccess(async (db) => {
        return db.customerProfile.update({
            where: { userId },
            data: {
                primaryDiagnosis: data.primaryDiagnosis,
                referringProviderName: data.referringProviderName ?? null,
                onboardingStep: Math.max(customer.onboardingStep, 3),
            },
        });
    });

    return {
        message: "Medical information saved successfully",
        customer: { id: updated.id, onboardingStep: updated.onboardingStep },
    };
};

export const deleteIndividualDocument = async (userId, documentId) => {
    const document = await prisma.licenseDocument.findUnique({ where: { id: documentId } });

    if (!document) throw new NotFoundError("Document not found");
    if (document.isDeleted) throw new BadRequestError("Document already deleted");

    const customer = await prisma.customerProfile.findUnique({ where: { userId } });

    if (!customer || document.customerId !== customer.id) {
        throw new BadRequestError("Not authorized to delete this document");
    }

    await prisma.licenseDocument.update({
        where: { id: documentId },
        data: { isDeleted: true, deletedAt: new Date() },
    });

    await deleteFileFromStorage(document.bucket || INDIVIDUAL_DOCUMENTS_BUCKET, document.documentUrl);

    return { message: "Document deleted successfully" };
};

export const getIndividualConsentContent = async (userId, documentType) => {
    const ALLOWED = [
        INDIVIDUAL_CONSENT_DOCUMENT_TYPES.HIPAA_CONSENT,
        INDIVIDUAL_CONSENT_DOCUMENT_TYPES.TREATMENT_CONSENT,
    ];

    if (!ALLOWED.includes(documentType)) {
        throw new BadRequestError(`Unknown individual consent document type: ${documentType}`);
    }

    const customer = await prisma.customerProfile.findUnique({ where: { userId } });
    if (!customer) throw new NotFoundError("Customer profile not found");

    const content = documentType === INDIVIDUAL_CONSENT_DOCUMENT_TYPES.HIPAA_CONSENT
        ? renderIndividualHipaaConsent(customer)
        : renderIndividualTreatmentConsent(customer);

    return { documentType, content };
};

export const signIndividualConsentDocument = async (userId, { documentType, signature, representativeName, representativeRelationship, representativeAuthority }) => {
    const ALLOWED = [
        INDIVIDUAL_CONSENT_DOCUMENT_TYPES.HIPAA_CONSENT,
        INDIVIDUAL_CONSENT_DOCUMENT_TYPES.TREATMENT_CONSENT,
    ];

    if (!ALLOWED.includes(documentType)) {
        throw new BadRequestError(`Unknown individual consent document type: ${documentType}`);
    }

    const isRepresentative = !!(representativeName || representativeRelationship || representativeAuthority);
    if (isRepresentative) {
        if (!representativeName || !representativeRelationship || !representativeAuthority) {
            throw new BadRequestError("All representative fields (name, relationship, authority) are required when signing on behalf of another person.");
        }
    }

    const customer = await prisma.customerProfile.findUnique({ where: { userId } });
    if (!customer) throw new NotFoundError("Customer profile not found");

    const signedText = renderSignedIndividualConsentDocument(documentType, customer, signature);

    const existing = await prisma.customerConsentSignature.findFirst({
        where: { customerId: customer.id, documentType },
    });

    if (existing) {
        await prisma.customerConsentSignature.update({
            where: { id: existing.id },
            data: {
                signature,
                signedText,
                signedAt: new Date(),
                representativeName: representativeName ?? null,
                representativeRelationship: representativeRelationship ?? null,
                representativeAuthority: representativeAuthority ?? null,
            },
        });
    } else {
        await prisma.customerConsentSignature.create({
            data: {
                customerId: customer.id,
                documentType,
                signature,
                signedText,
                representativeName: representativeName ?? null,
                representativeRelationship: representativeRelationship ?? null,
                representativeAuthority: representativeAuthority ?? null,
            },
        });
    }

    const allSigs = await prisma.customerConsentSignature.findMany({
        where: { customerId: customer.id },
    });
    const signedTypes = new Set(allSigs.map((s) => s.documentType));
    const consentFormsComplete =
        signedTypes.has(INDIVIDUAL_CONSENT_DOCUMENT_TYPES.HIPAA_CONSENT) &&
        signedTypes.has(INDIVIDUAL_CONSENT_DOCUMENT_TYPES.TREATMENT_CONSENT);

    const updated = await withAdminAccess(async (db) => {
        return db.customerProfile.update({
            where: { userId },
            data: consentFormsComplete ? { onboardingStep: Math.max(customer.onboardingStep, 4) } : {},
        });
    });

    return {
        message: "Consent document signed successfully",
        customer: { id: updated.id, onboardingStep: updated.onboardingStep },
    };
};

export const completeIndividualOnboarding = async (userId) => {
    const customer = await prisma.customerProfile.findUnique({
        where: { userId },
        include: { customerConsentSignatures: true },
    });

    if (!customer) throw new NotFoundError("Customer profile not found");

    const hasPersonalInfo = !!(
        customer.dateOfBirth &&
        customer.addressLine1 &&
        customer.city &&
        customer.state &&
        customer.zipCode
    );
    const hasMedicalInfo = !!customer.primaryDiagnosis;
    const signedTypes = new Set(customer.customerConsentSignatures.map((s) => s.documentType));
    const hasHipaaConsent = signedTypes.has(INDIVIDUAL_CONSENT_DOCUMENT_TYPES.HIPAA_CONSENT);
    const hasTreatmentConsent = signedTypes.has(INDIVIDUAL_CONSENT_DOCUMENT_TYPES.TREATMENT_CONSENT);

    const incompleteSteps = [
        !hasPersonalInfo && "personalInfo",
        !hasMedicalInfo && "medicalInfo",
        !hasHipaaConsent && "hipaaConsent",
        !hasTreatmentConsent && "treatmentConsent",
    ].filter(Boolean);

    if (incompleteSteps.length > 0) {
        throw new BadRequestError(
            `All onboarding steps must be completed before activation: ${incompleteSteps.join(", ")}`
        );
    }

    if (customer.onboardingComplete) {
        return {
            message: "Individual onboarding already complete.",
            customer: {
                id: customer.id,
                onboardingComplete: customer.onboardingComplete,
                approvalStatus: customer.approvalStatus,
            },
        };
    }

    const updated = await withAdminAccess(async (db) => {
        return db.customerProfile.update({
            where: { userId },
            data: {
                onboardingComplete: true,
                onboardingStep: 5,
                approvalStatus: APPROVAL_STATUS.APPROVED,
            },
        });
    });

    return {
        message: "Your account is now active. Welcome to RehabTask!",
        customer: {
            id: updated.id,
            onboardingComplete: updated.onboardingComplete,
            approvalStatus: updated.approvalStatus,
        },
    };
};