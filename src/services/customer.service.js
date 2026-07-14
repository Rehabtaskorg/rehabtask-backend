import { prisma } from "../config/prisma.js";
import { NotFoundError } from "../utils/errors.js";

/**
 * Update mutable fields on a customer's own profile.
 * Only `agencyName` is exposed for now — extend `allowedFields` as needed.
 *
 * @param {string} userId - Firebase UID from the authenticated request
 * @param {{ agencyName?: string }} data - Validated request body
 * @returns {Promise<import("@prisma/client").CustomerProfile>}
 */
export const updateCustomerProfile = async (userId, data) => {
    const profile = await prisma.customerProfile.findUnique({ where: { userId } });
    if (!profile) throw new NotFoundError("Customer profile not found");

    const { agencyName } = data;
    const updateData = {};
    if (agencyName !== undefined) updateData.agencyName = agencyName;

    const updated = await prisma.customerProfile.update({
        where: { userId },
        data: updateData,
    });

    return updated;
};