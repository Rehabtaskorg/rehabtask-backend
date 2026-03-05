import { prisma } from "../config/prisma.js";
import { supabaseAdmin } from "../config/supabase.js";
import { NotFoundError, ConflictError, BadRequestError } from "../utils/errors.js";
import { logger } from "../config/logger.js";

export const VALID_PERMISSIONS = [
    "users",
    "therapists",
    "disputes",
    "bookings",
    "payments",
    "subscriptions",
    "faqs",
    "notifications",
    "commission",
];

const validatePermissions = (permissions) => {
    const invalid = permissions.filter((p) => !VALID_PERMISSIONS.includes(p));
    if (invalid.length > 0) {
        throw new BadRequestError(
            `Invalid permissions: ${invalid.join(", ")}. Valid options: ${VALID_PERMISSIONS.join(", ")}`
        );
    }
};

export const listSubAdmins = async ({ isActive, page = 1, limit = 20 } = {}) => {
    const profileWhere = isActive !== undefined ? { isActive } : {};
    const where = {
        subAdminProfile: Object.keys(profileWhere).length > 0
            ? { ...profileWhere }
            : { isNot: null },
    };

    const [subAdmins, total] = await Promise.all([
        prisma.user.findMany({
            where,
            select: {
                id: true,
                email: true,
                isActive: true,
                createdAt: true,
                subAdminProfile: {
                    select: {
                        id: true,
                        permissions: true,
                        isActive: true,
                        createdAt: true,
                        createdByAdmin: { select: { id: true, email: true } },
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
        subAdmins,
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
}

export const getSubAdminDetail = async (userId) => {
    const user = await prisma.user.findUnique({
        where: { id: userId },
        include: {
            subAdminProfile: {
                include: {
                    createdByAdmin: { select: { id: true, email: true } },
                },
            },
        },
    });
    if (!user || !user.subAdminProfile) throw new NotFoundError("Sub-admin not found");
    return user;
}

/**
 * Invite a brand-new sub-admin by email
 * Creates a Supabase auth invite + User + SubAdminProfile
 */
export const createSubAdmin = async (email, permissions, adminId) => {
    validatePermissions(permissions);

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
        throw new ConflictError("A user with this email already exists");
    }

    const { data: inviteData, error: inviteError } =
        await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
            data: { role: "sub_admin" },
        });

    if (inviteError) {
        logger.error("[AdminSubAdminService] Supabase invite failed", {
            email,
            error: inviteError.message,
        });
        throw new BadRequestError(`Failed to send invite: ${inviteError.message}`);
    }

    const user = await prisma.user.create({
        data: {
            id: inviteData.user.id,
            email,
            role: "sub_admin",
            isActive: true,
            subAdminProfile: {
                create: {
                    permissions,
                    isActive: true,
                    createdByAdminId: adminId
                },
            },
        },
        include: { subAdminProfile: true },
    });

    logger.info("[AdminSubAdminService] Sub-admin created", {
        userId: user.id,
        email,
        byAdmin: adminId,
    });
    return user;
}

/**
 * Promote an existing user to sub_admin role
 */
export const promoteToSubAdmin = async (userId, permissions, adminId) => {
    validatePermissions(permissions);

    const user = await prisma.user.findUnique({
        where: { id: userId },
        include: { subAdminProfile: true },
    });
    if (!user) throw new NotFoundError("User not found");
    if (user.role === "admin") throw new BadRequestError("Cannot modify an admin account");
    if (user.subAdminProfile) throw new ConflictError("User already has a sub-admin profile");

    const updated = await prisma.user.update({
        where: { id: userId },
        data: {
            role: "sub_admin",
            subAdminProfile: {
                create: {
                    permissions,
                    isActive: true,
                    createdByAdminId: adminId
                },
            },
        },
        include: { subAdminProfile: true },
    });

    logger.info("[AdminSubAdminService] User promoted to sub-admin", {
        userId,
        byAdmin: adminId,
    });
    return updated;
}

export const updateSubAdminPermissions = async (userId, permissions, adminId) => {
    validatePermissions(permissions);

    const profile = await prisma.subAdminProfile.findUnique({ where: { userId } });
    if (!profile) throw new NotFoundError("Sub-admin profile not found");

    const updated = await prisma.subAdminProfile.update({
        where: { userId },
        data: { permissions },
    });

    logger.info("[AdminSubAdminService] Permissions updated", { userId, byAdmin: adminId });
    return updated;
}

export const deactivateSubAdmin = async (userId, adminId) => {
    if (userId === adminId) throw new BadRequestError("You cannot deactivate your own account");

    const profile = await prisma.subAdminProfile.findUnique({ where: { userId } });
    if (!profile) throw new NotFoundError("Sub-admin profile not found");
    if (!profile.isActive) throw new ConflictError("Sub-admin is already inactive");

    const updated = await prisma.subAdminProfile.update({
        where: { userId },
        data: { isActive: false },
    });

    logger.info("[AdminSubAdminService] Sub-admin deactivated", { userId, byAdmin: adminId });
    return updated;
}

export const reactivateSubAdmin = async (userId, adminId) => {
    const profile = await prisma.subAdminProfile.findUnique({ where: { userId } });
    if (!profile) throw new NotFoundError("Sub-admin profile not found");
    if (profile.isActive) throw new ConflictError("Sub-admin is already active");

    const updated = await prisma.subAdminProfile.update({
        where: { userId },
        data: { isActive: true },
    });

    logger.info("[AdminSubAdminService] Sub-admin reactivated", { userId, byAdmin: adminId });
    return updated;
}