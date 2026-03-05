import { prisma } from "../config/prisma.js";
import { NotFoundError, BadRequestError, ConflictError } from "../utils/errors.js";
import { logger } from "../config/logger.js";

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
                    select: { id: true, fullName: true, customerType: true },
                },
                therapistProfile: {
                    select: {
                        id: true,
                        fullName: true,
                        approvalStatus: true,
                        approvedAt: true,
                    },
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

export const deactivateUser = async (userId, adminId) => {
    if (userId === adminId) {
        throw new BadRequestError("You cannot deactivate your own account");
    }
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundError("User not found");
    if (!user.isActive) throw new ConflictError("User is already deactivated");

    const updated = await prisma.user.update({
        where: { id: userId },
        data: { isActive: false, deactivatedAt: new Date() },
    });

    logger.info("[AdminUserService] User deactivated", { userId, byAdmin: adminId });
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