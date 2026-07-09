import { APPROVAL_STATUS } from "../utils/constants.js";
import { prisma } from "../config/prisma.js";
import { NotFoundError, ConflictError, BadRequestError } from "../utils/errors.js";
import { logger } from "../config/logger.js";
import { sendTherapistApproved, sendTherapistRejected } from "./email.service.js";
import { getSignedUrl } from "./storage.service.js";
export const listTherapists = async ({
    approvalStatus,
    search,
    page = 1,
    limit = 20,
} = {}) => {
    const where = { therapistProfile: { isNot: null } };
    const profileFilter = {};
    if (approvalStatus) profileFilter.approvalStatus = approvalStatus;
    if (Object.keys(profileFilter).length) where.therapistProfile = profileFilter;
    if (search) {
        where.OR = [
            { email: { contains: search, mode: "insensitive" } },
            { therapistProfile: { fullName: { contains: search, mode: "insensitive" } } },
        ];
    }

    const [therapists, total] = await Promise.all([
        prisma.user.findMany({
            where,
            select: {
                id: true,
                email: true,
                isActive: true,
                emailVerified: true,
                createdAt: true,
                therapistProfile: {
                    select: {
                        id: true,
                        fullName: true,
                        phone: true,
                        approvalStatus: true,
                        approvedAt: true,
                        rejectionReason: true,
                        primaryLicenseType: true,
                        yearsOfExperience: true,
                        onboardingComplete: true,
                        backgroundCheckStatus: true,
                        planTier: true,
                        licenseDocuments: {
                            where: { isDeleted: false },
                            select: { id: true },
                        },
                    },
                },
            },
            orderBy: { createdAt: "desc" },
            skip: (page - 1) * limit,
            take: limit,
        }),
        prisma.user.count({ where }),
    ]);

    return {
        therapists,
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
};

export const getTherapistDetail = async (therapistUserId) => {
    const user = await prisma.user.findUnique({
        where: { id: therapistUserId },
        include: {
            therapistProfile: {
                include: {
                    licenseDocuments: {
                        where: { isDeleted: false },
                        orderBy: { uploadedAt: "desc" },
                    },
                    workAreas: true,
                    availability: true,
                },
            },
        },
    });
    if (!user || !user.therapistProfile) throw new NotFoundError("Therapist not found");
    return user;
}

export const approveTherapist = async (therapistUserId, adminId) => {
    const user = await prisma.user.findUnique({
        where: { id: therapistUserId },
        include: { therapistProfile: true },
    });
    if (!user || !user.therapistProfile) throw new NotFoundError("Therapist not found");
    if (user.therapistProfile.approvalStatus === APPROVAL_STATUS.APPROVED) {
        throw new ConflictError("Therapist is already approved");
    }

    const therapist = await prisma.therapistProfile.update({
        where: { userId: therapistUserId },
        data: {
            approvalStatus: APPROVAL_STATUS.APPROVED,
            approvedAt: new Date(),
            approvedBy: adminId,
            rejectionReason: null,
        },
        include: { user: { select: { email: true } } },
    });

    sendTherapistApproved({ therapist }).catch(() => { });

    logger.info("[AdminTherapistService] Therapist approved", {
        therapistUserId,
        byAdmin: adminId,
    });

    return therapist;
}

export const rejectTherapist = async (therapistUserId, reason, adminId) => {
    if (!reason || reason.trim().length < 10) {
        throw new BadRequestError("Rejection reason must be at least 10 characters");
    }

    const user = await prisma.user.findUnique({
        where: { id: therapistUserId },
        include: { therapistProfile: true },
    });
    if (!user || !user.therapistProfile) throw new NotFoundError("Therapist not found");
    if (user.therapistProfile.approvalStatus === APPROVAL_STATUS.REJECTED) {
        throw new ConflictError("Therapist is already rejected");
    }

    const therapist = await prisma.therapistProfile.update({
        where: { userId: therapistUserId },
        data: {
            approvalStatus: APPROVAL_STATUS.REJECTED,
            approvedAt: null,
            approvedBy: null,
            rejectionReason: reason.trim(),
        },
        include: { user: { select: { email: true } } },
    });

    sendTherapistRejected({ therapist, reason: reason.trim() }).catch(() => { });

    logger.info("[AdminTherapistService] Therapist rejected", {
        therapistUserId,
        byAdmin: adminId,
    });
    return therapist;
}

export const getDocumentSignedUrl = async (therapistUserId, documentId) => {
    const document = await prisma.licenseDocument.findUnique({
        where: { id: documentId },
        include: { therapist: true },
    });

    if (!document) throw new NotFoundError("Document not found");
    if (document.isDeleted) throw new NotFoundError("Document has been deleted");

    // Verify document belongs to the specified therapist
    if (document.therapist.userId !== therapistUserId) {
        throw new BadRequestError("Document does not belong to this therapist");
    }

    const { signedUrl } = await getSignedUrl(document.bucket, document.documentUrl, 60);

    return {
        signedUrl,
        expiresIn: 60,
        fileName: document.fileName,
        fileSize: document.fileSize,
        mimeType: document.mimeType,
    };
}

