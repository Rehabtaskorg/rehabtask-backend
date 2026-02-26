import { prisma } from "../config/prisma.js";
import { haversineDistance } from "../utils/distance.js";

export const createRequest = async (customerId, data) => {
    const { serviceType, description, preferredDate, location, latitude, longitude } = data;

    const request = await prisma.therapyRequest.create({
        data: {
            customerId,
            serviceType,
            description,
            preferredDate: new Date(preferredDate),
            location,
            latitude,
            longitude,
            status: "created"
        },
    });

    return request;
}

export const getCustomerRequests = async (customerId) => {
    const requests = await prisma.therapyRequest.findMany({
        where: { customerId },
        include: { offers: { include: { therapist: true } } },
        orderBy: { createdAt: "desc" },
    });

    return requests;
}

export const getRequestById = async (requestId, userId) => {
    const user = await prisma.user.findUnique({
        where: { id: userId },
        include: { therapistProfile: true, customerProfile: true }
    });

    const request = await prisma.therapyRequest.findUnique({
        where: { id: requestId },
        include: {
            customer: { include: { user: true } },
            offers: {
                where: user?.therapistProfile
                    ? { therapistId: user.therapistProfile.id } // therapist sees only their own offers
                    : undefined, // customer sees all offers
                include: { therapist: true, },
                orderBy: { createdAt: "desc" }
            },
        },
    });

    if (!request) throw new Error("Request not found");

    const isCustomer = request.customer.userId === userId;
    const isTherapist = user?.therapistProfile !== null;

    if (!isCustomer && !isTherapist) throw new Error("Unauthorized");

    return request;
}

// GEO-FILTERED: Only return requests within the therapist's work area radii
export const getAvailableRequests = async (therapistId) => {
    // Fetch therapist's work areas
    const workAreas = await prisma.workArea.findMany({
        where: { therapistId },
    });

    // If therapist hasn't set up work areas, return empty array
    if (!workAreas || workAreas.length === 0) {
        return [];
    }

    // Fetch all open requests
    const requests = await prisma.therapyRequest.findMany({
        where: { status: { in: ["created", "offers_received"] } },
        include: { customer: true, offers: { where: { therapistId } } },
        orderBy: { createdAt: "desc" }
    });

    // Filter requests that fall within ANY of the therapist's work area radii
    const filteredRequests = requests.filter((request) => {
        const requestLast = parseFloat(request.latitude);
        const requestLng = parseFloat(request.longitude);

        return workAreas.some((area) => {
            const areaLat = parseFloat(area.latitude);
            const areaLng = parseFloat(area.longitude);
            const distance = haversineDistance(requestLast, requestLng, areaLat, areaLng);
            return distance <= area.radiusMiles;
        });
    });

    return filteredRequests;
}

export const updateRequestStatus = async (requestId, status) => {
    const request = await prisma.therapyRequest.update({
        where: { id: requestId },
        data: { status }
    });

    return request;
}