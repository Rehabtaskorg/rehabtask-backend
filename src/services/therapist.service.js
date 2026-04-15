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

    // Cap guard: attemptedVisitRate cannot exceed ratePerVisit.
    if (allowedData.attemptedVisitRate != null) {
        const effectiveRate = allowedData.ratePerVisit !== undefined
            ? allowedData.ratePerVisit
            : (therapist.ratePerVisit != null ? parseFloat(therapist.ratePerVisit) : null);
        if (effectiveRate == null) {
            throw new BadRequestError(
                "Set your session rate before setting an attempted visit rate."
            );
        }
        if (allowedData.attemptedVisitRate > effectiveRate) {
            throw new BadRequestError(
                "Attempted visit rate cannot be greater than your session rate."
            );
        }
    }

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
        where: { therapistId: therapist.id }
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
    search,
    latitude,
    longitude,
    radiusMiles = 50,
    specialization,
    primaryLicenseType,
    sortBy,
    page = 1,
    limit = 20,
}) => {
    const hasLocation = latitude !== undefined && longitude !== undefined;

    let therapists;
    let total;

    // Build dynamic where clause
    const where = {
        approvalStatus: "approved",
        onboardingComplete: true,
    };

    // Full-text name search (case-insensitive contains)
    if (search && search.trim().length >= 2) {
        where.fullName = { contains: search.trim(), mode: "insensitive" };
    }

    // Multi-value specialization filter (comma-separated)
    if (specialization) {
        const specs = specialization.split(",").map((s) => s.trim()).filter(Boolean);
        if (specs.length === 1) {
            where.specialization = { contains: specs[0], mode: "insensitive" };
        } else if (specs.length > 1) {
            where.OR = specs.map((s) => ({
                specialization: { contains: s, mode: "insensitive" },
            }));
        }
    }

    // Multi-value license type filter (comma-separated)
    if (primaryLicenseType) {
        const types = primaryLicenseType.split(",").map((t) => t.trim()).filter(Boolean);
        if (types.length === 1) {
            where.primaryLicenseType = { equals: types[0], mode: "insensitive" };
        } else if (types.length > 1) {
            where.primaryLicenseType = { in: types };
        }
    }

    // Determine sort order for non-geo queries
    const getOrderBy = () => {
        switch (sortBy) {
            case "experience":
                return { yearsOfExperience: "desc" };
            case "newest":
                return { createdAt: "desc" };
            // "rating" and "relevance" are handled post-query (computed fields)
            default:
                return { createdAt: "desc" };
        }
    };

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

        // Apply sorting on the geo-filtered set
        sortTherapists(geoFiltered, sortBy);

        total = geoFiltered.length;

        // Manual pagination on the geo-filtered set
        const start = (page - 1) * limit;
        therapists = geoFiltered.slice(start, start + limit);
    } else {
        // No location — return all approved therapists, paginated
        // For rating sort, we fetch all and sort post-query (computed field)
        if (sortBy === "rating") {
            const allTherapists = await prisma.therapistProfile.findMany({
                where,
                include: {
                    workAreas: true,
                    reviews: { select: { rating: true } },
                },
            });

            sortTherapists(allTherapists, sortBy);

            total = allTherapists.length;
            const start = (page - 1) * limit;
            therapists = allTherapists.slice(start, start + limit);
        } else {
            const [therapists_result, total_result] = await Promise.all([
                prisma.therapistProfile.findMany({
                    where,
                    include: {
                        workAreas: true,
                        reviews: { select: { rating: true } },
                    },
                    skip: (page - 1) * limit,
                    take: limit,
                    orderBy: getOrderBy(),
                }),
                prisma.therapistProfile.count({ where }),
            ]);

            therapists = therapists_result;
            total = total_result;
        }
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
            ratePerVisit: t.ratePerVisit,
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

/**
 * Sort therapists in-place by the given sort criteria.
 * Handles computed fields (rating) that can't be sorted at the DB level.
 */
function sortTherapists(therapists, sortBy) {
    const getAvgRating = (t) => {
        if (!t.reviews || t.reviews.length === 0) return 0;
        return t.reviews.reduce((sum, r) => sum + r.rating, 0) / t.reviews.length;
    };

    switch (sortBy) {
        case "rating":
            therapists.sort((a, b) => getAvgRating(b) - getAvgRating(a));
            break;
        case "experience":
            therapists.sort((a, b) => (b.yearsOfExperience || 0) - (a.yearsOfExperience || 0));
            break;
        case "newest":
            therapists.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
            break;
        default:
            // "relevance" or undefined — keep default order (createdAt desc)
            therapists.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
            break;
    }
}

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
        userId: therapist.userId,
        fullName: therapist.fullName,
        phone: therapist.phone,
        specialization: therapist.specialization,
        profilePhotoUrl: therapist.profilePhotoUrl,
        yearsOfExperience: therapist.yearsOfExperience,
        primaryLicenseType: therapist.primaryLicenseType,
        professionalSummary: therapist.professionalSummary,
        ratePerVisit: therapist.ratePerVisit,
        attemptedVisitRate: therapist.attemptedVisitRate,
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

export const getPlatformStats = async () => {
    const [therapistCount, sessionCount, avgRating, distinctCities, distinctStates] = await Promise.all([
        prisma.therapistProfile.count({
            where: { approvalStatus: "approved", onboardingComplete: true },
        }),
        prisma.session.count({
            where: { status: "confirmed_by_customer" },
        }),
        prisma.review.aggregate({ _avg: { rating: true } }),
        prisma.workArea.findMany({
            where: { therapist: { approvalStatus: "approved", onboardingComplete: true } },
            distinct: ["city"],
            select: { city: true },
        }),
        prisma.workArea.findMany({
            where: { therapist: { approvalStatus: "approved", onboardingComplete: true } },
            distinct: ["state"],
            select: { state: true },
        }),
    ]);

    return {
        therapists: therapistCount,
        sessionsCompleted: sessionCount,
        averageRating: avgRating._avg.rating ? parseFloat(avgRating._avg.rating.toFixed(1)) : 4.8,
        citiesCovered: distinctCities.length,
        statesCovered: distinctStates.length,
    };
};