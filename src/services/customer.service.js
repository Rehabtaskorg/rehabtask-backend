import { prisma } from "../config/prisma.js";
import { NotFoundError } from "../utils/errors.js";
import { removeTwilioSuppression } from "./sms.service.js";

/**
 * Update mutable fields on a customer's own profile.
 * When smsOptIn flips from false → true, removes the number from Twilio's
 * suppression list so delivery actually works again after a prior STOP.
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

    const reEnabling = smsOptIn === true && profile.smsOptIn === false;
    if (reEnabling) {
        const phoneToUse = phone ?? profile.phone;
        if (phoneToUse) await removeTwilioSuppression(phoneToUse);
    }

    return prisma.customerProfile.update({ where: { userId }, data: updateData });
};
