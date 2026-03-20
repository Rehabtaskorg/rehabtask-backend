import { prisma } from "../config/prisma.js";
import { VISIT_TYPES } from "../../prisma/seeds/visitTypes.js";
import { logger } from "../config/logger.js";

/**
 * Get visit types filtered by discipline.
 * "All" discipline types (e.g., Missed Visit) are included for every discipline.
 */
export const getVisitTypesByDiscipline = async (discipline) => {
    return prisma.visitType.findMany({
        where: {
            isActive: true,
            OR: [
                { discipline },
                { discipline: "All" },
            ],
        },
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        select: { id: true, code: true, name: true, discipline: true },
    });
};

/**
 * Get all visit types (admin).
 */
export const getAllVisitTypes = async () => {
    return prisma.visitType.findMany({
        orderBy: [{ discipline: "asc" }, { sortOrder: "asc" }],
    });
};

/**
 * Create a new visit type (admin).
 */
export const createVisitType = async ({ code, name, discipline, sortOrder = 0 }) => {
    return prisma.visitType.create({
        data: { code: code.toUpperCase(), name, discipline, sortOrder },
    });
};

/**
 * Update a visit type (admin).
 */
export const updateVisitType = async (id, data) => {
    const updateData = {};
    if (data.name !== undefined) updateData.name = data.name;
    if (data.discipline !== undefined) updateData.discipline = data.discipline;
    if (data.isActive !== undefined) updateData.isActive = data.isActive;
    if (data.sortOrder !== undefined) updateData.sortOrder = data.sortOrder;
    if (data.code !== undefined) updateData.code = data.code.toUpperCase();

    return prisma.visitType.update({
        where: { id },
        data: updateData,
    });
};

/**
 * Seed visit types — upsert to avoid duplicates on re-run.
 */
export const seedVisitTypes = async () => {
    let created = 0;
    let skipped = 0;

    for (const vt of VISIT_TYPES) {
        const existing = await prisma.visitType.findUnique({ where: { code: vt.code } });
        if (existing) {
            skipped++;
            continue;
        }
        await prisma.visitType.create({ data: vt });
        created++;
    }

    logger.info(`[VisitTypes] Seeded: ${created} created, ${skipped} already existed`);
    return { created, skipped };
};