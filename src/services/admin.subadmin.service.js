import { USER_ROLES } from "../utils/constants.js";
import { prisma } from "../config/prisma.js";
import { getIdentityPlatformAuth } from "../config/identityPlatform.js";
import { NotFoundError, ConflictError, BadRequestError } from "../utils/errors.js";
import { logger } from "../config/logger.js";
import { env } from "../config/env.js";
import { sendAccountDeactivated, sendSubAdminInviteEmail } from "./email.service.js";

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

/**
 * @param {{isActive?: boolean, page?: number, limit?: number}} params
 */
export const listSubAdmins = async ({ isActive, page = 1, limit = 20 } = {}) => {
    const profileWhere = isActive !== undefined ? { isActive } : {};
    const where = {
        subAdminProfile: Object.keys(profileWhere).length > 0 ? { ...profileWhere } : { isNot: null },
    };

    const [subAdmins, total] = await Promise.all([
        prisma.user.findMany({
            where,
            select: {
                id: true,
                email: true,
                isActive: true,
                emailVerified: true,
                createdAt: true,
                customerProfile: { select: { fullName: true } },
                therapistProfile: { select: { fullName: true } },
                subAdminProfile: {
                    select: {
                        id: true,
                        fullName: true,
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
};

/**
 * @param {string} userId
 */
export const getSubAdminDetail = async (userId) => {
    const user = await prisma.user.findUnique({
        where: { id: userId },
        include: {
            subAdminProfile: { include: { createdByAdmin: { select: { id: true, email: true } } } },
        },
    });
    if (!user || !user.subAdminProfile) throw new NotFoundError("Sub-admin not found");
    return user;
};

/**
 * Invite a brand-new sub-admin by email.
 * Creates an Identity Platform auth user, generates a sign-in link, and sends the invite via Resend.
 *
 * @param {string} email
 * @param {string[]} permissions
 * @param {string} adminId
 */
export const createSubAdmin = async (email, permissions, adminId) => {
    validatePermissions(permissions);

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) throw new ConflictError("A user with this email already exists");

    const auth = getIdentityPlatformAuth();
    let authUser;
    try {
        authUser = await auth.createUser({ email, emailVerified: false });
    } catch (err) {
        logger.error("[AdminSubAdminService] Identity Platform user creation failed", { email, error: err.message });
        throw new BadRequestError(`Failed to create auth user: ${err.message}`);
    }

    const inviteLink = await auth.generateSignInWithEmailLink(email, {
        url: `${env.FRONTEND_URL}/invite/accept?email=${encodeURIComponent(email)}`,
        handleCodeInApp: true,
    });

    sendSubAdminInviteEmail({ email, inviteLink }).catch((err) => {
        logger.error("[AdminSubAdminService] Failed to send invite email", { email, error: err.message });
    });

    const user = await prisma.user.create({
        data: {
            id: authUser.uid,
            email,
            role: USER_ROLES.SUB_ADMIN,
            isActive: true,
            subAdminProfile: {
                create: { permissions, isActive: true, createdByAdminId: adminId },
            },
        },
        include: { subAdminProfile: true },
    });

    logger.info("[AdminSubAdminService] Sub-admin created", { userId: user.id, email, byAdmin: adminId });
    return user;
};

/**
 * Promote an existing user to sub_admin role.
 *
 * @param {string} userId
 * @param {string[]} permissions
 * @param {string} adminId
 */
export const promoteToSubAdmin = async (userId, permissions, adminId) => {
    validatePermissions(permissions);

    const user = await prisma.user.findUnique({ where: { id: userId }, include: { subAdminProfile: true } });
    if (!user) throw new NotFoundError("User not found");
    if (user.role === USER_ROLES.ADMIN) throw new BadRequestError("Cannot modify an admin account");
    if (user.subAdminProfile) throw new ConflictError("User already has a sub-admin profile");

    const updated = await prisma.user.update({
        where: { id: userId },
        data: {
            role: USER_ROLES.SUB_ADMIN,
            subAdminProfile: { create: { permissions, isActive: true, createdByAdminId: adminId } },
        },
        include: { subAdminProfile: true },
    });

    logger.info("[AdminSubAdminService] User promoted to sub-admin", { userId, byAdmin: adminId });
    return updated;
};

/**
 * @param {string} userId
 * @param {string[]} permissions
 * @param {string} adminId
 */
export const updateSubAdminPermissions = async (userId, permissions, adminId) => {
    validatePermissions(permissions);

    const profile = await prisma.subAdminProfile.findUnique({ where: { userId } });
    if (!profile) throw new NotFoundError("Sub-admin profile not found");

    const updated = await prisma.subAdminProfile.update({ where: { userId }, data: { permissions } });

    logger.info("[AdminSubAdminService] Permissions updated", { userId, byAdmin: adminId });
    return updated;
};

/**
 * @param {string} userId
 * @param {string} adminId
 */
export const deactivateSubAdmin = async (userId, adminId) => {
    if (userId === adminId) throw new BadRequestError("You cannot deactivate your own account");

    const profile = await prisma.subAdminProfile.findUnique({ where: { userId } });
    if (!profile) throw new NotFoundError("Sub-admin profile not found");
    if (!profile.isActive) throw new ConflictError("Sub-admin is already inactive");

    const [updatedProfile] = await prisma.$transaction([
        prisma.subAdminProfile.update({ where: { userId }, data: { isActive: false } }),
        prisma.user.update({ where: { id: userId }, data: { isActive: false, deactivatedAt: new Date() } }),
    ]);

    const auth = getIdentityPlatformAuth();
    auth.revokeRefreshTokens(userId).catch(() => { });

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (user) sendAccountDeactivated({ user }).catch(() => { });

    logger.info("[AdminSubAdminService] Sub-admin deactivated", { userId, byAdmin: adminId });
    return updatedProfile;
};

/**
 * @param {string} userId
 * @param {string} adminId
 */
export const reactivateSubAdmin = async (userId, adminId) => {
    const profile = await prisma.subAdminProfile.findUnique({ where: { userId } });
    if (!profile) throw new NotFoundError("Sub-admin profile not found");
    if (profile.isActive) throw new ConflictError("Sub-admin is already active");

    const [updatedProfile] = await prisma.$transaction([
        prisma.subAdminProfile.update({ where: { userId }, data: { isActive: true } }),
        prisma.user.update({ where: { id: userId }, data: { isActive: true, deactivatedAt: null } }),
    ]);

    logger.info("[AdminSubAdminService] Sub-admin reactivated", { userId, byAdmin: adminId });
    return updatedProfile;
};

/**
 * Resend the invite email to a sub-admin who has not yet accepted.
 * Regenerates the sign-in link — does not recreate the auth user.
 *
 * @param {string} userId
 */
export const resendSubAdminInvite = async (userId) => {
    const user = await prisma.user.findUnique({ where: { id: userId }, include: { subAdminProfile: true } });
    if (!user || !user.subAdminProfile) throw new NotFoundError("Sub-admin not found");
    if (user.emailVerified) throw new ConflictError("Sub-admin has already accepted their invite");

    const auth = getIdentityPlatformAuth();
    const inviteLink = await auth.generateSignInWithEmailLink(user.email, {
        url: `${env.FRONTEND_URL}/invite/accept?email=${encodeURIComponent(user.email)}`,
    });

    sendSubAdminInviteEmail({ email: user.email, inviteLink }).catch((err) => {
        logger.error("[AdminSubAdminService] Failed to resend invite email", { userId, error: err.message });
    });

    logger.info("[AdminSubAdminService] Invite resent", { userId });
    return { resent: true };
};
