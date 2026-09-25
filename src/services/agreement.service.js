import { prisma } from "../config/prisma.js";
import { AGREEMENT_VERSION, AGREEMENT_ROLE_SECTIONS } from "../utils/constants.js";
import { AGREEMENT_SECTIONS } from "../data/unifiedAgreement.js";

/**
 * @param {string} userId
 * @param {string} role
 * @param {string} [ipAddress]
 * @param {string} [userAgent]
 */
export const recordAgreementAcceptance = async (userId, role, ipAddress, userAgent) => {
    await prisma.unifiedAgreementAcceptance.upsert({
        where: { userId_agreementVersion: { userId, agreementVersion: AGREEMENT_VERSION } },
        create: { userId, userRole: role, agreementVersion: AGREEMENT_VERSION, ipAddress, userAgent },
        update: { acceptedAt: new Date(), ipAddress, userAgent },
    });
};

/**
 * @param {string} userId
 * @returns {Promise<boolean>}
 */
export const hasAcceptedAgreement = async (userId) => {
    const row = await prisma.unifiedAgreementAcceptance.findUnique({
        where: { userId_agreementVersion: { userId, agreementVersion: AGREEMENT_VERSION } },
        select: { userId: true },
    });
    return row !== null;
};

/**
 * @param {string} role  — "therapist" | "customer" | "agency"
 * @returns {{ sectionNumber: number, title: string, body: string }[]}
 */
export const getAgreementSectionsForRole = (role) => {
    const sectionNumbers = AGREEMENT_ROLE_SECTIONS[role] ?? AGREEMENT_ROLE_SECTIONS.customer;
    return sectionNumbers.map((n) => ({
        sectionNumber: n,
        title: AGREEMENT_SECTIONS[n].title,
        body: AGREEMENT_SECTIONS[n].body,
    }));
};
