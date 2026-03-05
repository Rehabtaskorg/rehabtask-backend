import { prisma } from "../config/prisma.js";
import { NotFoundError, ConflictError, BadRequestError } from "../utils/errors.js";
import { logger } from "../config/logger.js";
import { sendTherapistApproved, sendTherapistRejected } from "./email.service.js";
import { createNotification } from "./notification.service.js";

export const listTherapists = async ({
    approvalStatus,
    search,
    page = 1,
    limit = 20,
} = {}) => {
    const where = { therapistProfile: { isNot: null } };
    if (approvalStatus) {
        where.therapistProfile = { approvalStatus };
    }
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
                    licenseDocuments: true,
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
    if (user.therapistProfile.approvalStatus === "approved") {
        throw new ConflictError("Therapist is already approved");
    }

    const therapist = await prisma.therapistProfile.update({
        where: { userId: therapistUserId },
        data: {
            approvalStatus: "approved",
            approvedAt: new Date(),
            approvedBy: adminId,
            rejectionReason: null,
        },
        include: { user: { select: { email: true } } },
    });

    sendTherapistApproved({ therapist }).catch(() => { });

    createNotification({
        userId: therapistUserId,
        type: "therapist_approved",
        title: "Application Approved",
        message:
            "Congratulations! Your therapist application has been approved. You can now receive session requests.",
        entityType: "therapistProfile",
        entityId: therapist.id
    }).catch(() => { });

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
    if (user.therapistProfile.approvalStatus === "rejected") {
        throw new ConflictError("Therapist is already rejected");
    }

    const therapist = await prisma.therapistProfile.update({
        where: { userId: therapistUserId },
        data: {
            approvalStatus: "rejected",
            approvedAt: null,
            approvedBy: null,
            rejectionReason: reason.trim(),
        },
        include: { user: { select: { email: true } } },
    });

    sendTherapistRejected({ therapist, reason: reason.trim() }).catch(() => { });

    createNotification({
        userId: therapistUserId,
        type: "therapist_rejected",
        title: "Application Not Approved",
        message: `Your therapist application was not approved. Reason: ${reason.trim()}`,
        entityType: "therapistProfile",
        entityId: therapist.id,
    }).catch(() => { });

    logger.info("[AdminTherapistService] Therapist rejected", {
        therapistUserId,
        byAdmin: adminId,
    });
    return therapist;
}