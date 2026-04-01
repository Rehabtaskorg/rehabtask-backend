import { prisma } from "../config/prisma.js";
import { haversineDistance } from "../utils/distance.js";

/**
 * Browse open therapy requests publicly.
 * Only returns safe fields — no customer identity, patient info, or exact coordinates.
 */
export const browsePublicRequests = async ({
    serviceType,
    search,
    latitude,
    longitude,
    radiusMiles = 50,
    page = 1,
    limit = 10,
} = {}) => {
    const hasLocation = latitude !== undefined && longitude !== undefined;

    const where = {
        status: { in: ["created", "offers_received"] },
    };

    if (serviceType) {
        where.serviceType = { equals: serviceType, mode: "insensitive" };
    }

    if (search && search.trim().length >= 2) {
        where.OR = [
            { description: { contains: search.trim(), mode: "insensitive" } },
            { serviceType: { contains: search.trim(), mode: "insensitive" } },
        ];
    }

    let requests;
    let total;

    if (hasLocation) {
        // Fetch all matching requests then filter by distance
        const allRequests = await prisma.therapyRequest.findMany({
            where,
            select: {
                id: true,
                serviceType: true,
                description: true,
                location: true,
                latitude: true,
                longitude: true,
                preferredDate: true,
                visitsPerWeek: true,
                numberOfWeeks: true,
                visitType: true,
                createdAt: true,
                _count: { select: { offers: true } },
                customer: { select: { agencyName: true, fullName: true } },
            },
            orderBy: { createdAt: "desc" },
        });

        const geoFiltered = allRequests.filter((r) => {
            const distance = haversineDistance(
                latitude,
                longitude,
                parseFloat(r.latitude),
                parseFloat(r.longitude)
            );
            return distance <= radiusMiles;
        });

        total = geoFiltered.length;
        const start = (page - 1) * limit;
        requests = geoFiltered.slice(start, start + limit);
    } else {
        [requests, total] = await Promise.all([
            prisma.therapyRequest.findMany({
                where,
                select: {
                    id: true,
                    serviceType: true,
                    description: true,
                    location: true,
                    preferredDate: true,
                    visitsPerWeek: true,
                    numberOfWeeks: true,
                    visitType: true,
                    createdAt: true,
                    _count: { select: { offers: true } },
                    customer: { select: { agencyName: true, fullName: true } },
                },
                orderBy: { createdAt: "desc" },
                skip: (page - 1) * limit,
                take: limit,
            }),
            prisma.therapyRequest.count({ where }),
        ]);
    }

    // Sanitize location to city-level only (strip street addresses)
    const sanitized = requests.map((r) => {
        const parts = r.location ? r.location.split(",").map((s) => s.trim()) : [];
        const cityState = parts.length >= 2 ? `${parts[parts.length - 2]}, ${parts[parts.length - 1]}` : r.location || "Location not specified";

        return {
            id: r.id,
            serviceType: r.serviceType,
            description: r.description,
            locationCity: cityState,
            preferredDate: r.preferredDate,
            visitsPerWeek: r.visitsPerWeek,
            numberOfWeeks: r.numberOfWeeks,
            visitType: r.visitType,
            createdAt: r.createdAt,
            offerCount: r._count.offers,
            customerName: r.customer?.agencyName || r.customer?.fullName || null,
        };
    });

    return {
        requests: sanitized,
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
};
