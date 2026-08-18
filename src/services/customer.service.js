import { prisma } from "../config/prisma.js";
import { NotFoundError } from "../utils/errors.js";

/**
 * Update mutable fields on a customer's own profile.
 *
 * @param {string} userId - Firebase UID from the authenticated request
 * @param {{ agencyName?: string, phone?: string, smsOptIn?: boolean }} data - Validated request body
 * @returns {Promise<import("@prisma/client").CustomerProfile>}
 */
export const updateCustomerProfile = async (userId, data) => {
    const profile = await prisma.customerProfile.findUnique({ where: { userId } });
    if (!profile) throw new NotFoundError("Customer profile not found");

    const { agencyName, phone, smsOptIn } = data;
    const updateData = {};
    if (agencyName !== undefined) updateData.agencyName = agencyName;
    if (phone !== undefined) updateData.phone = phone;
    if (smsOptIn !== undefined) updateData.smsOptIn = smsOptIn;

    return prisma.customerProfile.update({ where: { userId }, data: updateData });
};
