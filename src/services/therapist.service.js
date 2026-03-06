import { prisma, withAdminAccess } from "../config/prisma.js";
import { NotFoundError, BadRequestError } from "../utils/errors.js";
import { haversineDistance } from "../utils/distance.js";

export const getTherapistProfile = async (userId) => {
    const therapist = await prisma.therapistProfile.findUnique({
        where: { userId },
        include: {
            workAreas: true,
            availability: true,
            licenseDocuments: {
                where: { isDeleted: false },
                orderBy: { uploadedAt: "desc" },
            },
        },
    });

    if (!therapist) throw new NotFoundError("Therapist profile not found");

    return therapist;
}

export const updateTherapistProfile = async (userId, data) => {
    const therapist = await prisma.therapistProfile.findUnique({
        where: { userId },
    });

    if (!therapist) throw new NotFoundError("Therapist profile not found");

    if (!therapist.onboardingComplete) {
        throw new BadRequestError(
            "Please complete onboarding before updating your profile"
        );
    }

    // Prevent changing license fields through this endpoint
    const { licenseNumber, licenseState, ...allowedData } = data;

    const updated = await withAdminAccess(async (tx) => {
        return tx.therapistProfile.update({
            where: { userId },
            data: allowedData,
        });
    });

    return updated;
}

export const updateWorkAreas = async (therapistId, workAreas) => {
    const result = await prisma.$transaction(async (tx) => {
        // Delete all existing work areas
        await tx.workArea.deleteMany({
            where: { therapistId }
        });

        // Create new work areas
        const created = await Promise.all(
            workAreas.map((area) =>
                tx.workArea.create({
                    data: {
                        therapistId,
                        zipCode: area.zipCode,
                        city: area.city,
                        state: area.state,
                        latitude: area.latitude,
                        longitude: area.longitude,
                        radiusMiles: area.radiusMiles ?? 25,
                    },
                })
            )
        );

        return created;
    });

    return result;
}

export const updateAvailability = async (userId, scheduleData) => {
    const therapist = await prisma.therapistProfile.findUnique({
        where: { userId },
    });

    if (!therapist) throw new NotFoundError("Therapist profile not found");

    // Delete existing availability
    await prisma.availability.deleteMany({
        where: { therapist: therapist.id }
    });

    // Create new availability records (same pattern as onboarding.service.js)
    const daysOfWeek = [
        "monday",
        "tuesday",
        "wednesday",
        "thursday",
        "friday",
        "saturday",
        "sunday",
    ];

    const availabilityRecords = daysOfWeek
        .filter((day) => scheduleData[day]?.enabled)
        .map((day) => ({
            therapistId: therapist.id,
            dayOfWeek: day,
            isEnabled: true,
            timeBlocks: scheduleData[day].timeBlocks,
        }));

    if (availabilityRecords.length > 0) {
        await prisma.availability.createMany({
            data: availabilityRecords,
        });
    }

    const updatedAvailability = await prisma.availability.findMany({
        where: { therapistId: therapist.id }
    });

    return updateAvailability;
};

export const searchTherapists = async ({
    latitude,
    longitude,
    radiusMiles = 50,
    specialization,
    primaryLicenseType,
    page = 1,
    limit = 20,
}) => {
    const hasLocation = latitude !== undefined && longitude !== undefined;

    /**
     * @typedef {import("@prisma/client").TherapistProfile & {
     *   workAreas: import("@prisma/client").WorkArea[],
     *   reviews: { rating: number }[]
     * }} TherapistWithRelations
     */

    /** @type {TherapistWithRelations[]} */
    let therapists;
    let total;

    // Build dynamic where clause
    const where = {
        approvalStatus: "approved",
        onboardingComplete: true,
    };

    if (specialization) {
        where.specialization = { contains: specialization, mode: "insensitive" };
    }

    if (primaryLicenseType) {
        where.primaryLicenseType = { equals: primaryLicenseType, mode: "insensitive" };
    }

    if (hasLocation) {
        const allTherapists = await prisma.therapistProfile.findMany({
            where,
            include: {
                workAreas: true,
                reviews: { select: { rating: true } },
            },
        });

        // Filter by radius overlap: search point within any work area circle
        const geoFiltered = allTherapists.filter((therapist) =>
            therapist.workAreas.some((area) => {
                const distance = haversineDistance(
                    latitude,
                    longitude,
                    parseFloat(area.latitude),
                    parseFloat(area.longitude)
                );
                return distance <= area.radiusMiles && distance <= radiusMiles;
            })
        );

        total = geoFiltered.length;

        // Manual pagination on the geo-filtered set
        const start = (page - 1) * limit;
        therapists = geoFiltered.slice(start, start + limit);
    } else {
        // No location — return all approved therapists, paginated
        const [therapists_result, total_result] = await Promise.all([
            prisma.therapistProfile.findMany({
                where,
                include: {
                    workAreas: true,
                    reviews: { select: { rating: true } },
                },
                skip: (page - 1) * limit,
                take: limit,
                orderBy: { createdAt: "desc" },
            }),
            prisma.therapistProfile.count({ where }),
        ]);

        therapists = therapists_result;
        total = total_result;
    }

    // Map to public response shape with aggregated review stats
    const result = therapists.map((t) => {
        const reviewCount = t.reviews.length;
        const averageRating =
            reviewCount > 0
                ? parseFloat(
                    (
                        t.reviews.reduce((sum, r) => sum + r.rating, 0) / reviewCount
                    ).toFixed(2)
                )
                : null;

        return {
            id: t.id,
            fullName: t.fullName,
            specialization: t.specialization,
            profilePhotoUrl: t.profilePhotoUrl,
            yearsOfExperience: t.yearsOfExperience,
            primaryLicenseType: t.primaryLicenseType,
            professionalSummary: t.professionalSummary,
            workAreas: t.workAreas.map((wa) => ({
                city: wa.city,
                state: wa.state,
            })),
            averageRating,
            reviewCount,
        };
    });

    return {
        therapists: result,
        pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit),
        },
    };
};

export const getTherapistPublicProfile = async (therapistId) => {
    const therapist = await prisma.therapistProfile.findUnique({
        where: { id: therapistId },
        include: {
            workAreas: true,
            availability: true,
            reviews: {
                select: { rating: true },
            },
        },
    });

    if (!therapist || therapist.approvalStatus !== "approved") {
        throw new NotFoundError("Therapist not found");
    }

    const reviewCount = therapist.reviews.length;
    const averageRating =
        reviewCount > 0
            ? parseFloat(
                (
                    therapist.reviews.reduce((sum, r) => sum + r.rating, 0) /
                    reviewCount
                ).toFixed(2)
            )
            : null;

    return {
        id: therapist.id,
        fullName: therapist.fullName,
        phone: therapist.phone,
        specialization: therapist.specialization,
        profilePhotoUrl: therapist.profilePhotoUrl,
        yearsOfExperience: therapist.yearsOfExperience,
        primaryLicenseType: therapist.primaryLicenseType,
        professionalSummary: therapist.professionalSummary,
        workAreas: therapist.workAreas.map((wa) => ({
            id: wa.id,
            zipCode: wa.zipCode,
            city: wa.city,
            state: wa.state,
            latitude: wa.latitude,
            longitude: wa.longitude,
            radiusMiles: wa.radiusMiles,
        })),
        availability: therapist.availability,
        averageRating,
        reviewCount
    };
};

export const getTherapistReviews = async (therapistId, page = 1, limit = 10) => {
    const therapist = await prisma.therapistProfile.findUnique({
        where: { id: therapistId },
    });

    if (!therapist || therapist.approvalStatus !== "approved") {
        throw new NotFoundError("Therapist not found");
    }

    const where = { therapistId };

    const [reviews, total] = await Promise.all([
        prisma.review.findMany({
            where,
            include: {
                customer: {
                    select: {
                        fullName: true
                    },
                },
            },
            orderBy: { createdAt: "desc" },
            skip: (page - 1) * limit,
            take: limit,
        }),
        prisma.review.count({ where }),
    ]);

    return {
        reviews,
        pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit),
        },
    };
};