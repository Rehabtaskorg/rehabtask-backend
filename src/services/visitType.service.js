import { USER_ROLES } from "../utils/constants.js";
import { prisma } from "../config/prisma.js";
import { VISIT_TYPES } from "../../prisma/seeds/visitTypes.js";
import { logger } from "../config/logger.js";
import { disciplineForServiceType } from "../utils/visitPlan.js";

/**
 * Map a therapist license type to a visit type discipline.
 * Assistants (PTA, OTA) see the same visit types as their parent discipline.
 */
const licenseToDiscipline = (licenseType) => {
    if (!licenseType) return "";
    if (licenseType.includes("Physical Therapist")) return "Physical Therapist";
    if (licenseType.includes("Occupational Therapist")) return "Occupational Therapist";
    if (licenseType.includes("Speech")) return "Speech Therapist";
    return licenseType;
};

/**
 * Resolve a discipline string from the various inputs callers may have.
 * Accepts either a raw discipline, a customer-facing service type, or a
 * therapist license type. Returns null if nothing maps.
 */
const resolveDiscipline = ({ discipline, serviceType, licenseType }) => {
    if (discipline) return discipline;
    if (serviceType) return disciplineForServiceType(serviceType);
    if (licenseType) return licenseToDiscipline(licenseType);
    return null;
};

/**
 * Fetch visit types for a given audience + discipline lens.
 *
 * @param {object} opts
 * @param {string} [opts.discipline]   - Raw discipline string (e.g. "Physical Therapist")
 * @param {string} [opts.serviceType]  - Customer-facing service type (e.g. "Physical Therapy")
 * @param {string} [opts.licenseType]  - Therapist license type (e.g. "Physical Therapist Assistant")
 * @param {"customer"|"therapist"} [opts.audience="therapist"]
 *        - "customer" → also filter by customerVisible=true
 *        - "therapist" → no visibility filter (therapists see all codes in their discipline)
 *        - The "All" discipline bucket (e.g. Missed Visit) is always included
 *          for therapist audiences and excluded for customer audiences (those
 *          are therapist-internal workflow codes by design).
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
                    // Customers see only customer-visible codes in their chosen discipline.
                    // No "All" bucket — workflow codes like Missed Visit don't belong in
                    // the customer request wizard.
                    discipline: resolvedDiscipline,
                    customerVisible: true,
                }
                : {
                    // Therapists see all codes in their discipline + the shared "All" bucket.
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

/**
 * Legacy alias — preserved for any callers still passing a raw license type.
 * Prefer `getVisitTypes({ licenseType })` in new code.
 */
export const getVisitTypesByDiscipline = async (licenseType) => {
    return getVisitTypes({ licenseType, audience: USER_ROLES.THERAPIST });
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
export const createVisitType = async ({ code, name, discipline, sortOrder = 0, customerVisible = true }) => {
    return prisma.visitType.create({
        data: { code: code.toUpperCase(), name, discipline, sortOrder, customerVisible },
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
    if (data.customerVisible !== undefined) updateData.customerVisible = data.customerVisible;
    if (data.code !== undefined) updateData.code = data.code.toUpperCase();

    return prisma.visitType.update({
        where: { id },
        data: updateData,
    });
};

/**
 * Therapist-internal codes that should be hidden from the customer picker.
 * Kept here (not in the seed file) because it's a business/UX decision about
 * which codes customers are allowed to request, not a clinical catalog fact.
 */
const THERAPIST_INTERNAL_CODES = new Set([
    "MV",    // Missed Visit
    "PTSU",  // PT Supervisory
    "OTSU",  // OT Supervisory
    "PTAV",  // PT Attempted
    "OTAV",  // OT Attempted
    "STAV",  // ST Attempted
    "PTFA",  // PT Assistant Follow-up
    "OTFA",  // OT Assistant Follow-up
]);

/**
 * Seed visit types — upsert to avoid duplicates on re-run.
 * Applies the customer_visible flag based on THERAPIST_INTERNAL_CODES.
 */
export const seedVisitTypes = async () => {
    let created = 0;
    let skipped = 0;

    for (const vt of VISIT_TYPES) {
        const customerVisible = !THERAPIST_INTERNAL_CODES.has(vt.code);
        const existing = await prisma.visitType.findUnique({ where: { code: vt.code } });
        if (existing) {
            // Re-apply the customer_visible flag in case the seed list changed
            // or the flag was introduced after an earlier seed run. Idempotent.
            if (existing.customerVisible !== customerVisible) {
                await prisma.visitType.update({
                    where: { code: vt.code },
                    data: { customerVisible },
                });
            }
            skipped++;
            continue;
        }
        await prisma.visitType.create({ data: { ...vt, customerVisible } });
        created++;
    }

    logger.info(`[VisitTypes] Seeded: ${created} created, ${skipped} already existed`);
    return { created, skipped };
};
