import { prisma } from "../config/prisma.js";
import { NotFoundError, ConflictError, BadRequestError, AuthorizationError } from "../utils/errors.js";
import { logger } from "../config/logger.js";
import { sendDisputeStatusUpdate, sendDisputeReopened } from "./email.service.js";

const DISPUTE_INCLUDE = {
    user: {
        select: {
            id: true, email: true, role: true,
            customerProfile: { select: { fullName: true } },
            therapistProfile: { select: { fullName: true } },
        },
    },
    assignedAdmin: {
        select: { id: true, email: true },
    },
    booking: {
        select: { scheduledDate: true, sessionType: true, status: true },
    },
};

export const adminListDisputes = async ({
    status,
    assignedAdminId,
    unassigned,
    page = 1,
    limit = 20,
    callerRole,
    callerUserId,
} = {}) => {
    const where = {};
    if (status) where.status = status;

    // Sub-admins can only see disputes assigned to them
    if (callerRole === "sub_admin") {
        where.assignedAdminId = callerUserId;
    } else {
        if (assignedAdminId) where.assignedAdminId = assignedAdminId;
        if (unassigned === true) where.assignedAdminId = null;
    }

    const [disputes, total] = await Promise.all([
        prisma.dispute.findMany({
            where,
            include: DISPUTE_INCLUDE,
            orderBy: { createdAt: "desc" },
            skip: (page - 1) * limit,
            take: limit,
        }),
        prisma.dispute.count({ where }),
    ]);

    return {
        disputes,
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
}

export const adminGetDispute = async (disputeId, callerRole, callerUserId) => {
    const dispute = await prisma.dispute.findUnique({
        where: { id: disputeId },
        include: DISPUTE_INCLUDE,
    });
    if (!dispute) throw new NotFoundError("Dispute not found");

    if (callerRole === "sub_admin" && dispute.assignedAdminId !== callerUserId) {
        throw new AuthorizationError(
            "You can only view disputes assigned to you",
            "DISPUTE_NOT_ASSIGNED"
        );
    }

    return dispute;
}

export const assignDispute = async (disputeId, assignedAdminId, byAdminId, callerRole) => {
    if (callerRole === "sub_admin") {
        throw new AuthorizationError("Only admins can assign disputes", "INSUFFICIENT_PERMISSIONS");
    }

    const [dispute, admin] = await Promise.all([
        prisma.dispute.findUnique({ where: { id: disputeId } }),
        prisma.user.findUnique({ where: { id: assignedAdminId } }),
    ]);

    if (!dispute) throw new NotFoundError("Dispute not found");
    if (!admin || !["admin", "sub_admin"].includes(admin.role)) {
        throw new BadRequestError("Assignee must be an admin or sub-admin");
    }
    if (dispute.status === "closed") {
        throw new ConflictError("Cannot assign a closed dispute");
    }

    const updated = await prisma.dispute.update({
        where: { id: disputeId },
        data: {
            assignedAdminId,
            status: dispute.status === "open" ? "under_review" : dispute.status,
        },
        include: DISPUTE_INCLUDE,
    });

    logger.info("[AdminDisputeService] Dispute assigned", {
        disputeId,
        assignedTo: assignedAdminId,
        byAdmin: byAdminId,
    });
    return updated;
};

export const adminUpdateDispute = async (
    disputeId,
    adminUserId,
    { status, resolution, title, expectedUpdatedAt },
    callerRole
) => {
    const dispute = await prisma.dispute.findUnique({
        where: { id: disputeId },
        include: DISPUTE_INCLUDE,
    });
    if (!dispute) throw new NotFoundError("Dispute not found");

    if (callerRole === "sub_admin" && dispute.assignedAdminId !== adminUserId) {
        throw new AuthorizationError(
            "You can only update disputes assigned to you",
            "DISPUTE_NOT_ASSIGNED"
        );
    }

    // Concurrency guard: reject if dispute was modified since the admin loaded it
    if (expectedUpdatedAt) {
        const expected = new Date(expectedUpdatedAt).getTime();
        const actual = new Date(dispute.updatedAt).getTime();
        if (actual !== expected) {
            throw new ConflictError(
                "This dispute was modified by another admin. Please refresh and try again."
            );
        }
    }

    const updateData = {};
    if (status !== undefined) updateData.status = status;
    if (resolution !== undefined) updateData.resolution = resolution;
    if (title !== undefined) updateData.title = title;

    if (status === "resolved" || status === "closed") {
        updateData.resolvedAt = new Date();
        updateData.resolvedBy = adminUserId;
    }

    const updated = await prisma.dispute.update({
        where: { id: disputeId },
        data: updateData,
        include: DISPUTE_INCLUDE
    });

    if (status && status !== dispute.status) {
        const statusMessages = {
            under_review: "Your dispute is now under review by our team.",
            resolved: "Your dispute has been resolved.",
            closed: "Your dispute has been closed."
        };
        const message = statusMessages[status] || `Your dispute status changed to: ${status}`;

        // Send email notification to the filer
        sendDisputeStatusUpdate({
            user: dispute.user,
            dispute: updated,
            statusMessage: message,
        }).catch(() => { });
    }

    logger.info("[AdminDisputeService] Dispute updated", {
        disputeId,
        status,
        byAdmin: adminUserId,
    });
    return updated;
}

export const reopenDispute = async (disputeId, adminUserId, callerRole) => {
    const dispute = await prisma.dispute.findUnique({
        where: { id: disputeId },
        include: DISPUTE_INCLUDE,
    });
    if (!dispute) throw new NotFoundError("Dispute not found");

    if (callerRole === "sub_admin" && dispute.assignedAdminId !== adminUserId) {
        throw new AuthorizationError(
            "You can only reopen disputes assigned to you",
            "DISPUTE_NOT_ASSIGNED"
        );
    }

    if (!["resolved", "closed"].includes(dispute.status)) {
        throw new ConflictError("Only resolved or closed disputes can be reopened");
    }

    const updated = await prisma.dispute.update({
        where: { id: disputeId },
        data: {
            status: "under_review",
            resolvedAt: null,
            resolvedBy: null
        },
        include: DISPUTE_INCLUDE,
    });

    // Send email notification to the filer
    sendDisputeReopened({
        user: dispute.user,
        dispute: updated,
    }).catch(() => { });

    logger.info("[AdminDisputeService] Dispute reopened", {
        disputeId,
        byAdmin: adminUserId,
    });
    return updated;
}