import { prisma } from "../config/prisma.js";
import { supabaseAdmin } from "../config/supabase.js";
import { NotFoundError, BadRequestError, ConflictError, AuthorizationError } from "../utils/errors.js";
import { logger } from "../config/logger.js";
import { sendAccountDeactivated } from "./email.service.js";

export const listUsers = async ({
    role,
    isActive,
    search,
    page = 1,
    limit = 20
} = {}) => {
    const where = {};
    if (role) where.role = role;
    if (typeof isActive === 'boolean') where.isActive = isActive;
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
                customerProfile: {
                    select: { id: true, fullName: true, customerType: true, agencyName: true },
                },
                therapistProfile: {
                    select: {
                        id: true,
                        fullName: true,
                        approvalStatus: true,
                        approvedAt: true,
                        primaryLicenseType: true,
                    },
                },
                subAdminProfile: {
                    select: { id: true, permissions: true, isActive: true },
                },
            },
            orderBy: { createdAt: "desc" },
            skip: (page - 1) * limit,
            take: limit,
        }),
        prisma.user.count({ where })
    ]);

    return {
        users,
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    }
}

export const getUserDetail = async (userId) => {
    const user = await prisma.user.findUnique({
        where: { id: userId },
        include: {
            customerProfile: true,
            therapistProfile: true,
            subAdminProfile: true,
        },
    });
    if (!user) throw new NotFoundError("User not found");
    return user;
}

export const deactivateUser = async (userId, adminId, callerRole) => {
    if (userId === adminId) {
        throw new BadRequestError("You cannot deactivate your own account");
    }
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundError("User not found");
    if (!user.isActive) throw new ConflictError("User is already deactivated");

    // Sub-admins cannot deactivate admin or other sub-admin accounts
    if (callerRole === "sub_admin" && (user.role === "admin" || user.role === "sub_admin")) {
        throw new AuthorizationError("Sub-admins cannot deactivate admin accounts");
    }

    const updated = await prisma.user.update({
        where: { id: userId },
        data: { isActive: false, deactivatedAt: new Date() },
    });

    // Revoke Supabase session so existing tokens are invalidated
    await supabaseAdmin.auth.admin.signOut(userId).catch(() => {});

    logger.info("[AdminUserService] User deactivated", { userId, byAdmin: adminId });

    // Notify user via email (non-blocking)
    const userWithProfile = await prisma.user.findUnique({
        where: { id: userId },
        include: { customerProfile: true, therapistProfile: true },
    });
    sendAccountDeactivated({ user: userWithProfile }).catch(() => {});

    return updated;
}

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
}

export const updateUser = async (userId, updates, adminId) => {
    const user = await prisma.user.findUnique({
        where: { id: userId },
        include: { customerProfile: true, therapistProfile: true },
    });
    if (!user) throw new NotFoundError("User not found");

    const { email, fullName, phone, customerType, agencyName, primaryLicenseType, bio } = updates;

    // Update email in both Supabase and Prisma
    if (email && email !== user.email) {
        const existing = await prisma.user.findUnique({ where: { email } });
        if (existing) throw new ConflictError("A user with this email already exists");

        const { error } = await supabaseAdmin.auth.admin.updateUserById(userId, { email });
        if (error) throw new BadRequestError(`Failed to update email: ${error.message}`);

        await prisma.user.update({ where: { id: userId }, data: { email } });
    }

    // Update customer profile fields
    const customerFields = {};
    if (fullName !== undefined && user.role === "customer") customerFields.fullName = fullName;
    if (phone !== undefined && user.role === "customer") customerFields.phone = phone;
    if (customerType !== undefined && user.role === "customer") customerFields.customerType = customerType;
    if (agencyName !== undefined && user.role === "customer") customerFields.agencyName = agencyName;

    if (Object.keys(customerFields).length > 0 && user.customerProfile) {
        await prisma.customerProfile.update({
            where: { userId },
            data: customerFields,
        });
    }

    // Update therapist profile fields
    const therapistFields = {};
    if (fullName !== undefined && user.role === "therapist") therapistFields.fullName = fullName;
    if (phone !== undefined && user.role === "therapist") therapistFields.phone = phone;
    if (primaryLicenseType !== undefined && user.role === "therapist") therapistFields.primaryLicenseType = primaryLicenseType;
    if (bio !== undefined && user.role === "therapist") therapistFields.bio = bio;

    if (Object.keys(therapistFields).length > 0 && user.therapistProfile) {
        await prisma.therapistProfile.update({
            where: { userId },
            data: therapistFields,
        });
    }

    // Return updated user
    const updated = await prisma.user.findUnique({
        where: { id: userId },
        include: { customerProfile: true, therapistProfile: true, subAdminProfile: true },
    });

    logger.info("[AdminUserService] User updated", { userId, byAdmin: adminId, fields: Object.keys(updates) });
    return updated;
}