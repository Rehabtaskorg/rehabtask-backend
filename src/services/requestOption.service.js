import { prisma } from "../config/prisma.js";

/**
 * Get all options of a given type, defaults first then alphabetical.
 */
export const getOptionsByType = async (type) => {
    const options = await prisma.requestOption.findMany({
        where: { type },
        orderBy: [
            { isDefault: "desc" },
            { value: "asc" },
        ],
        select: {
            id: true,
            value: true,
            isDefault: true,
        },
    });

    return options;
};

/**
 * Ensure an option exists for the given type+value.
 * If it doesn't exist, create it as a user-added (non-default) option.
 */
export const ensureOption = async (type, value) => {
    if (!value || !type) return;

    const trimmed = value.trim();
    if (!trimmed) return;

    await prisma.requestOption.upsert({
        where: {
            type_value: { type, value: trimmed },
        },
        update: {},
        create: {
            type,
            value: trimmed,
            isDefault: false,
        },
    });
};