import { USER_ROLES } from "../utils/constants.js";
import { prisma } from "../config/prisma.js";
import { VISIT_TYPES } from "../../prisma/seeds/visitTypes.js";
import { logger } from "../config/logger.js";
import { disciplineForServiceType } from "../utils/visitPlan.js";

const licenseToDiscipline = (licenseType) => {
    if (!licenseType) return "";
    if (licenseType.includes("Physical Therapist")) return "Physical Therapist";
    if (licenseType.includes("Occupational Therapist")) return "Occupational Therapist";
    if (licenseType.includes("Speech")) return "Speech Therapist";
    return licenseType;
};

const resolveDiscipline = ({ discipline, serviceType, licenseType }) => {
    if (discipline) return discipline;
    if (serviceType) return disciplineForServiceType(serviceType);
    if (licenseType) return licenseToDiscipline(licenseType);
    return null;
};

/**
 * @param {object} opts
 * @param {string} [opts.discipline]
 * @param {string} [opts.serviceType]
 * @param {string} [opts.licenseType]
 * @param {"customer"|"therapist"} [opts.audience="therapist"]
 * @returns {Promise<Array<{id:string,code:string,name:string,discipline:string,sortOrder:number}>>}
 */
export const getVisitTypes = async ({ discipline, serviceType, licenseType, audience = USER_ROLES.THERAPIST } = {}) => {
    const resolvedDiscipline = resolveDiscipline({ discipline, serviceType, licenseType });
    if (!resolvedDiscipline) return [];

    const isCustomer = audience === USER_ROLES.CUSTOMER;

    return prisma.visitType.findMany({
        where: {
            isActive: true,
            ...(isCustomer
                ? {
                    discipline: resolvedDiscipline,
                    customerVisible: true,
                }
                : {
                    OR: [
                        { discipline: resolvedDiscipline },
                        { discipline: "All" },
                    ],
                }),
        },
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        select: { id: true, code: true, name: true, discipline: true, sortOrder: true },
    });
};

export const getVisitTypesByDiscipline = async (licenseType) => {
    return getVisitTypes({ licenseType, audience: USER_ROLES.THERAPIST });
};

export const getAllVisitTypes = async () => {
    return prisma.visitType.findMany({
        orderBy: [{ discipline: "asc" }, { sortOrder: "asc" }],
    });
};

/**
 * @param {object} data
 * @param {boolean} [data.isActive]
 * @param {boolean} [data.customerVisible]
 */
export const updateVisitType = async (id, data) => {
    const updateData = {};
    if (data.isActive !== undefined) updateData.isActive = data.isActive;
    if (data.customerVisible !== undefined) updateData.customerVisible = data.customerVisible;

    return prisma.visitType.update({
        where: { id },
        data: updateData,
    });
};

const THERAPIST_INTERNAL_CODES = new Set([
    "MV",
    "CN",
    "PTSU",
    "OTSU",
    "PTAV",
    "OTAV",
    "STAV",
    "PTFA",
    "OTFA",
    "PTDN",
    "OTDN",
    "STDN",
]);

/**
 * Upserts the catalog from VISIT_TYPES. name/discipline/sortOrder are fully
 * synced on every run. isActive/customerVisible are only set when a row is
 * first created; existing rows keep their admin-managed values.
 */
export const seedVisitTypes = async () => {
    let created = 0;
    let updated = 0;

    for (const vt of VISIT_TYPES) {
        const existing = await prisma.visitType.findUnique({ where: { code: vt.code } });
        if (existing) {
            await prisma.visitType.update({
                where: { code: vt.code },
                data: { name: vt.name, discipline: vt.discipline, sortOrder: vt.sortOrder },
            });
            updated++;
            continue;
        }
        const customerVisible = !THERAPIST_INTERNAL_CODES.has(vt.code);
        await prisma.visitType.create({ data: { ...vt, customerVisible } });
        created++;
    }

    logger.info(`[VisitTypes] Seeded: ${created} created, ${updated} updated`);
    return { created, updated };
};
