import { prisma } from "../config/prisma.js";
import { CONTACT_UNLOCK_BOOKING_STATUSES } from "./constants.js";

/**
 * Safe field selection for TherapistProfile on customer-facing responses.
 * Never includes PII fields (phone, address, DOB, stripeAccountId, etc.).
 * Use therapistSelectFor() to get the contact-unlocked variant.
 */
export const THERAPIST_SAFE_SELECT = {
    id: true,
    userId: true,
    fullName: true,
    profilePhotoUrl: true,
    specialization: true,
    primaryLicenseType: true,
    licenseState: true,
    yearsOfExperience: true,
    yearsInHomeHealth: true,
    professionalSummary: true,
    ratePerVisit: true,
    attemptedVisitRate: true,
    evaluationRate: true,
    travelFee: true,
    availableFrom: true,
    doesHomeVisits: true,
    hipaaAttested: true,
    licenseVerified: true,
    insuranceVerified: true,
    createdAt: true,
};

/**
 * Returns a Prisma select object for TherapistProfile.
 * Adds `phone` when the viewer has an unlocked booking relationship.
 *
 * @param {boolean} hasContact
 * @returns {Object}
 */
export const therapistSelectFor = (hasContact) =>
    hasContact ? { ...THERAPIST_SAFE_SELECT, phone: true } : THERAPIST_SAFE_SELECT;

/**
 * Returns true when a customer has an active or historical booking with a therapist
 * that justifies disclosing contact info.
 *
 * @param {string} customerProfileId - CustomerProfile.id (not userId)
 * @param {string} therapistProfileId - TherapistProfile.id
 * @returns {Promise<boolean>}
 */
export const hasContactAccessByProfileId = async (customerProfileId, therapistProfileId) => {
    if (!customerProfileId || !therapistProfileId) return false;
    const count = await prisma.booking.count({
        where: {
            customerId: customerProfileId,
            therapistId: therapistProfileId,
            status: { in: CONTACT_UNLOCK_BOOKING_STATUSES },
        },
    });
    return count > 0;
};

/**
 * Returns true when a customer has contact access, resolving their profile from userId.
 * Use hasContactAccessByProfileId instead when customerProfile.id is already in scope.
 *
 * @param {string} customerUserId - User.id (Identity Platform UID)
 * @param {string} therapistProfileId - TherapistProfile.id
 * @returns {Promise<boolean>}
 */
export const hasContactAccessByUserId = async (customerUserId, therapistProfileId) => {
    if (!customerUserId || !therapistProfileId) return false;
    const customerProfile = await prisma.customerProfile.findUnique({
        where: { userId: customerUserId },
        select: { id: true },
    });
    if (!customerProfile) return false;
    return hasContactAccessByProfileId(customerProfile.id, therapistProfileId);
};