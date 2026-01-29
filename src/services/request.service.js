import { prisma } from "../config/prisma.js";

/**
 * Create therapy request
 */
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

/**
 * Get customer's requests
 */
export const getCustomerRequests = async (customerId) => {
    const requests = await prisma.therapyRequest.findMany({
        where: { customerId },
        include: {
            offers: {
                include: {
                    therapist: true,
                },
            },
        },
        orderBy: { createdAt: "desc" }
    });

    return requests;
}

/**
 * Get request by ID
 */
export const getRequestById = async (requestId, userId) => {
    const request = await prisma.therapyRequest.findUnique({
        where: { id: requestId },
        include: {
            customer: { include: { user: true } },
            offers: {
                include: {
                    therapist: true,
                },
                orderBy: { createdAt: "desc" }
            },
        },
    });


    if (!request) {
        throw new Error("Request not found");
    }

    // Get the user with their profiles
    const user = await prisma.user.findUnique({
        where: { id: userId },
        include: {
            therapistProfile: true,
            customerProfile: true,
        }
    });

    // Authorization check
    const isCustomer = request.customer.userId === userId;
    const isTherapist = user?.therapistProfile !== null;

    if (!isCustomer && !isTherapist) {
        throw new Error("Unauthorized");
    }

    return request;
}

/**
 * Get available requests for therapist (within service area)
 */
export const getAvailableRequests = async (therapistId) => {
    // For MVP return all open requests
    // In production, filter by distance from therapist work areas
    const requests = await prisma.therapyRequest.findMany({
        where: {
            status: { in: ["created", "offers_received"] },
        },
        include: {
            customer: true,
            offers: {
                where: { therapistId },
            },
        },
        orderBy: { createdAt: "desc" }
    });

    return requests;
}

/**
 * Update request status
 */
export const updateRequestStatus = async (requestId, status) => {
    const request = await prisma.therapyRequest.update({
        where: { id: requestId },
        data: { status }
    });

    return request;
}