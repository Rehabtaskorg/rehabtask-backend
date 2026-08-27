import { APPROVAL_STATUS, SESSION_STATUS, THERAPIST_ATTRIBUTE_CATEGORIES, USER_ROLES } from "../utils/constants.js";
import { hasContactAccessByUserId } from "../utils/therapistContactAccess.js";
import { prisma, withAdminAccess } from "../config/prisma.js";
import { NotFoundError, BadRequestError } from "../utils/errors.js";
import { haversineDistance } from "../utils/distance.js";
import { geocodeZipCode, assertCoherenceOrLog } from "./geocoding.service.js";

export const getTherapistProfile = async (userId) => {
    const [therapist, completedSessionCount, reviewStats] = await Promise.all([
        prisma.therapistProfile.findUnique({
            where: { userId },
            include: {
                user: { select: { email: true } },
                attributes: true,
                workAreas: true,
                availability: true,
                licenseDocuments: {
                    where: { isDeleted: false },
                    orderBy: { uploadedAt: "desc" },
                },
            },
        }),
        prisma.session.count({
            where: {
                status: SESSION_STATUS.CONFIRMED_BY_CUSTOMER,
                booking: { therapist: { userId } },
            },
        }),
        prisma.review.aggregate({
            where: { therapist: { userId } },
            _avg: { rating: true },
            _count: { rating: true },
        }),
    ]);

    if (!therapist) throw new NotFoundError("Therapist profile not found");

    const attrsByCategory = {};
    for (const attr of therapist.attributes) {
        if (!attrsByCategory[attr.category]) attrsByCategory[attr.category] = [];
        attrsByCategory[attr.category].push(attr.value);
    }

    return {
        ...therapist,
        user: undefined,
        email: therapist.user?.email ?? null,
        specialties: attrsByCategory[THERAPIST_ATTRIBUTE_CATEGORIES.SPECIALTY] ?? [],
        languages: attrsByCategory[THERAPIST_ATTRIBUTE_CATEGORIES.LANGUAGE] ?? [],
        certifications: attrsByCategory[THERAPIST_ATTRIBUTE_CATEGORIES.CERTIFICATION] ?? [],
        pastSettings: attrsByCategory[THERAPIST_ATTRIBUTE_CATEGORIES.PAST_SETTING] ?? [],
        populationExperience: attrsByCategory[THERAPIST_ATTRIBUTE_CATEGORIES.POPULATION] ?? [],
        stats: {
            completedVisits: completedSessionCount,
            averageRating: reviewStats._avg.rating
                ? Math.round(reviewStats._avg.rating * 10) / 10
                : null,
            reviewCount: reviewStats._count.rating,
            memberSince: therapist.createdAt,
        },
    };
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
    const geocoded = await Promise.all(
        workAreas.map(async (area) => {
            // ZIP may be empty when therapist selects by city/address — skip geocode, trust frontend coordinates
            if (!area.zipCode) return area;
            const geo = await geocodeZipCode(area.zipCode);
            assertCoherenceOrLog(`workArea.${area.zipCode}`, area.latitude, area.longitude, geo.latitude, geo.longitude, 10);
            return { ...area, ...geo };
        })
    );

    const result = await prisma.$transaction(async (tx) => {
        await tx.workArea.deleteMany({ where: { therapistId } });

        await tx.workArea.createMany({
            data: geocoded.map((area) => ({
                therapistId,
                zipCode: area.zipCode,
                city: area.city,
                state: area.state,
                latitude: area.latitude,
                longitude: area.longitude,
                radiusMiles: area.radiusMiles ?? 25,
            })),
        });

        return tx.workArea.findMany({ where: { therapistId } });
    }, { timeout: 15000 });

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
    latitude,
    longitude,
    radiusMiles = 50,
    primaryLicenseType,
    sortBy,
    page = 1,
    limit = 20,
}) => {
    const hasLocation = latitude !== undefined && longitude !== undefined;

    let therapists;
    let total;

    const where = {
        approvalStatus: APPROVAL_STATUS.APPROVED,
        onboardingComplete: true,
        user: { isActive: true },
    };

    // Multi-value license type filter (comma-separated)
    if (primaryLicenseType) {
        const types = primaryLicenseType.split(",").map((t) => t.trim()).filter(Boolean);
        if (types.length === 1) {
            where.primaryLicenseType = { equals: types[0], mode: "insensitive" };
        } else if (types.length > 1) {
            where.OR = types.map((t) => ({
                primaryLicenseType: { equals: t, mode: "insensitive" },
            }));
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

        geoFiltered.forEach((therapist) => {
            therapist._minDistance = Math.min(
                ...therapist.workAreas.map((area) =>
                    haversineDistance(
                        latitude,
                        longitude,
                        parseFloat(area.latitude),
                        parseFloat(area.longitude)
                    )
                )
            );
        });

        // Apply sorting on the geo-filtered set
        sortTherapists(geoFiltered, sortBy);

        total = geoFiltered.length;

        // Manual pagination on the geo-filtered set
        const start = (page - 1) * limit;
        therapists = geoFiltered.slice(start, start + limit);
    } else {
        // No location — return all approved therapists, paginated
        // For rating sort, we fetch all and sort post-query (computed field)
        if (sortBy === "rating" || sortBy === "relevance") {
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
            userId: t.userId,
            fullName: t.fullName,
            specialization: t.specialization,
            profilePhotoUrl: t.profilePhotoUrl,
            yearsOfExperience: t.yearsOfExperience,
            primaryLicenseType: t.primaryLicenseType,
            professionalSummary: t.professionalSummary,
            ratePerVisit: t.ratePerVisit,
            attemptedVisitRate: t.attemptedVisitRate,
            workAreas: t.workAreas.map((wa) => ({
                city: wa.city,
                state: wa.state,
                latitude: wa.latitude,
                longitude: wa.longitude,
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
        case "relevance":
            if (therapists.length > 0 && therapists[0]._minDistance !== undefined) {
                therapists.sort((a, b) => (a._minDistance || 0) - (b._minDistance || 0));
            } else {
                therapists.sort((a, b) => getAvgRating(b) - getAvgRating(a));
            }
            break;
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
            therapists.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
            break;
    }
}

export const getTherapistPublicProfile = async (therapistId, viewerUserId = null, viewerRole = null) => {
    const [therapist, completedVisitCount, canViewContact] = await Promise.all([
        prisma.therapistProfile.findUnique({
            where: { id: therapistId },
            include: {
                user: { select: { isActive: true, email: true } },
                attributes: true,
                workAreas: true,
                availability: true,
                reviews: { select: { rating: true } },
            },
        }),
        prisma.session.count({
            where: {
                status: SESSION_STATUS.CONFIRMED_BY_CUSTOMER,
                booking: { therapist: { id: therapistId } },
            },
        }),
        hasContactAccessByUserId(viewerUserId, therapistId),
    ]);

    if (!therapist || therapist.approvalStatus !== APPROVAL_STATUS.APPROVED || therapist.user?.isActive === false) {
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

    const attrsByCategory = {};
    for (const attr of therapist.attributes) {
        if (!attrsByCategory[attr.category]) attrsByCategory[attr.category] = [];
        attrsByCategory[attr.category].push(attr.value);
    }

    return {
        id: therapist.id,
        userId: therapist.userId,
        fullName: therapist.fullName,
        canViewContact,
        ...(canViewContact && { phone: therapist.phone }),
        ...(canViewContact && { email: therapist.user?.email }),
        profilePhotoUrl: therapist.profilePhotoUrl,
        yearsOfExperience: therapist.yearsOfExperience,
        yearsInHomeHealth: therapist.yearsInHomeHealth,
        primaryLicenseType: therapist.primaryLicenseType,
        ...(viewerRole === USER_ROLES.CUSTOMER && { npiNumber: therapist.npiNumber }),
        professionalSummary: therapist.professionalSummary,
        ratePerVisit: therapist.ratePerVisit,
        attemptedVisitRate: therapist.attemptedVisitRate,
        evaluationRate: therapist.evaluationRate,
        travelFee: therapist.travelFee,
        availableFrom: therapist.availableFrom,
        hipaaAttested: therapist.hipaaAttested,
        licenseVerified: therapist.licenseVerified,
        insuranceVerified: therapist.insuranceVerified,
        memberSince: therapist.createdAt,
        specialties: attrsByCategory[THERAPIST_ATTRIBUTE_CATEGORIES.SPECIALTY] ?? [],
        languages: attrsByCategory[THERAPIST_ATTRIBUTE_CATEGORIES.LANGUAGE] ?? [],
        certifications: attrsByCategory[THERAPIST_ATTRIBUTE_CATEGORIES.CERTIFICATION] ?? [],
        pastSettings: attrsByCategory[THERAPIST_ATTRIBUTE_CATEGORIES.PAST_SETTING] ?? [],
        populationExperience: attrsByCategory[THERAPIST_ATTRIBUTE_CATEGORIES.POPULATION] ?? [],
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
        stats: {
            completedVisits: completedVisitCount,
            averageRating,
            reviewCount,
            memberSince: therapist.createdAt,
        },
        averageRating,
        reviewCount,
    };
};

export const getTherapistReviews = async (therapistId, page = 1, limit = 10) => {
    const therapist = await prisma.therapistProfile.findUnique({
        where: { id: therapistId },
        include: { user: { select: { isActive: true } } },
    });

    if (!therapist || therapist.approvalStatus !== APPROVAL_STATUS.APPROVED || therapist.user?.isActive === false) {
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
            where: { approvalStatus: APPROVAL_STATUS.APPROVED, onboardingComplete: true, user: { isActive: true } },
        }),
        prisma.session.count({
            where: { status: SESSION_STATUS.CONFIRMED_BY_CUSTOMER },
        }),
        prisma.review.aggregate({ _avg: { rating: true } }),
        prisma.workArea.findMany({
            where: { therapist: { approvalStatus: APPROVAL_STATUS.APPROVED, onboardingComplete: true, user: { isActive: true } } },
            distinct: ["city"],
            select: { city: true },
        }),
        prisma.workArea.findMany({
            where: { therapist: { approvalStatus: APPROVAL_STATUS.APPROVED, onboardingComplete: true, user: { isActive: true } } },
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