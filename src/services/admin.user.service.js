import { USER_ROLES } from "../utils/constants.js";
import { prisma } from "../config/prisma.js";
import { getIdentityPlatformAuth } from "../config/identityPlatform.js";
import { NotFoundError, BadRequestError, ConflictError, AuthorizationError } from "../utils/errors.js";
import { logger } from "../config/logger.js";
import { sendAccountDeactivated } from "./email.service.js";

/**
 * @param {{role?: string, isActive?: boolean, search?: string, page?: number, limit?: number}} params
 */
export const listUsers = async ({ role, isActive, search, page = 1, limit = 20 } = {}) => {
    const where = {};
    if (role) where.role = role;
    if (typeof isActive === "boolean") where.isActive = isActive;
    if (search) {
        where.OR = [
            { email: { contains: search, mode: "insensitive" } },
            { customerProfile: { fullName: { contains: search, mode: "insensitive" } } },
            { therapistProfile: { fullName: { contains: search, mode: "insensitive" } } },
        ];
    }

    const [users, total] = await Promise.all([
        prisma.user.findMany({
            where,
            select: {
                id: true,
                email: true,
                role: true,
                isActive: true,
                emailVerified: true,
                deactivatedAt: true,
                createdAt: true,
                customerProfile: { select: { id: true, fullName: true, customerType: true, agencyName: true } },
                therapistProfile: { select: { id: true, fullName: true, approvalStatus: true, approvedAt: true, primaryLicenseType: true, profilePhotoUrl: true } },
                subAdminProfile: { select: { id: true, permissions: true, isActive: true } },
            },
            orderBy: { createdAt: "desc" },
            skip: (page - 1) * limit,
            take: limit,
        }),
        prisma.user.count({ where }),
    ]);

    return {
        users,
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
};

/**
 * @param {string} userId
 */
export const getUserDetail = async (userId) => {
    const user = await prisma.user.findUnique({
        where: { id: userId },
        include: { customerProfile: true, therapistProfile: true, subAdminProfile: true },
    });
    if (!user) throw new NotFoundError("User not found");
    return user;
};

/**
 * @param {string} userId
 * @param {string} adminId
 * @param {string} callerRole
 */
export const deactivateUser = async (userId, adminId, callerRole) => {
    if (userId === adminId) throw new BadRequestError("You cannot deactivate your own account");

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundError("User not found");
    if (!user.isActive) throw new ConflictError("User is already deactivated");

    if (callerRole === USER_ROLES.SUB_ADMIN && (user.role === USER_ROLES.ADMIN || user.role === USER_ROLES.SUB_ADMIN)) {
        throw new AuthorizationError("Sub-admins cannot deactivate admin accounts");
    }

    const updated = await prisma.user.update({
        where: { id: userId },
        data: { isActive: false, deactivatedAt: new Date() },
    });

    const auth = getIdentityPlatformAuth();
    auth.revokeRefreshTokens(userId).catch(() => {});

    logger.info("[AdminUserService] User deactivated", { userId, byAdmin: adminId });

    const userWithProfile = await prisma.user.findUnique({
        where: { id: userId },
        include: { customerProfile: true, therapistProfile: true },
    });
    sendAccountDeactivated({ user: userWithProfile }).catch(() => {});

    return updated;
};

/**
 * @param {string} userId
 * @param {string} adminId
 */
export const reactivateUser = async (userId, adminId) => {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundError("User not found");
    if (user.isActive) throw new ConflictError("User is already active");

    const updated = await prisma.user.update({
        where: { id: userId },
        data: { isActive: true, deactivatedAt: null },
    });

    logger.info("[AdminUserService] User reactivated", { userId, byAdmin: adminId });
    return updated;
};

/**
 * @param {string} userId
 * @param {object} updates
 * @param {string} adminId
 */
export const updateUser = async (userId, updates, adminId) => {
    const user = await prisma.user.findUnique({
        where: { id: userId },
        include: { customerProfile: true, therapistProfile: true },
    });
    if (!user) throw new NotFoundError("User not found");

    const { email, fullName, phone, customerType, agencyName, primaryLicenseType, professionalSummary } = updates;

    if (email && email !== user.email) {
        const existing = await prisma.user.findUnique({ where: { email } });
        if (existing) throw new ConflictError("A user with this email already exists");

        const auth = getIdentityPlatformAuth();
        await auth.updateUser(userId, { email });
        await prisma.user.update({ where: { id: userId }, data: { email } });
    }

    const customerFields = {};
    if (fullName !== undefined && user.role === USER_ROLES.CUSTOMER) customerFields.fullName = fullName;
    if (phone !== undefined && user.role === USER_ROLES.CUSTOMER) customerFields.phone = phone;
    if (customerType !== undefined && user.role === USER_ROLES.CUSTOMER) customerFields.customerType = customerType;
    if (agencyName !== undefined && user.role === USER_ROLES.CUSTOMER) customerFields.agencyName = agencyName;

    if (Object.keys(customerFields).length > 0 && user.customerProfile) {
        await prisma.customerProfile.update({ where: { userId }, data: customerFields });
    }

    const therapistFields = {};
    if (fullName !== undefined && user.role === USER_ROLES.THERAPIST) therapistFields.fullName = fullName;
    if (phone !== undefined && user.role === USER_ROLES.THERAPIST) therapistFields.phone = phone;
    if (primaryLicenseType !== undefined && user.role === USER_ROLES.THERAPIST) therapistFields.primaryLicenseType = primaryLicenseType;
    if (professionalSummary !== undefined && user.role === USER_ROLES.THERAPIST) therapistFields.professionalSummary = professionalSummary;

    if (Object.keys(therapistFields).length > 0 && user.therapistProfile) {
        await prisma.therapistProfile.update({ where: { userId }, data: therapistFields });
    }

    const updated = await prisma.user.findUnique({
        where: { id: userId },
        include: { customerProfile: true, therapistProfile: true, subAdminProfile: true },
    });

    logger.info("[AdminUserService] User updated", { userId, byAdmin: adminId, fields: Object.keys(updates) });
    return updated;
};
