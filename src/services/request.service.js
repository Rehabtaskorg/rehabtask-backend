import { prisma } from "../config/prisma.js";
import { haversineDistance } from "../utils/distance.js";
import { ensureOption } from "./requestOption.service.js";
import { sendNewRequestNotifications } from "./email.service.js";
import { logger } from "../config/logger.js";
import { logAction } from "./audit.service.js";

export const createRequest = async (customerId, data, customerProfile) => {
    const { serviceType, description, preferredDate, location, latitude, longitude, patientId, rate, visitType, emr } = data;

    // IF patientId is provided, validate the patient belongs to this agency
    if (patientId) {
        if (customerProfile?.customerType !== "agency") {
            throw new Error("Only agency accounts can assign requests to patients");
        }

        const patient = await prisma.patient.findFirst({
            where: { id: patientId, agencyId: customerProfile.id, isActive: true }
        });
        if (!patient) {
            throw new Error("Patient not found or does not belong to your agency");
        }
    }

    const request = await prisma.therapyRequest.create({
        data: {
            customerId,
            serviceType,
            description,
            preferredDate: new Date(preferredDate),
            location,
            latitude,
            longitude,
            status: "created",
            ...(patientId && { patientId }),
            ...(rate != null && { rate }),
            ...(visitType && { visitType }),
            ...(emr && { emr }),
        },
    });

    // Event: request.created
    logAction({
        actorId: customerProfile.userId,
        action: "request.created",
        entityType: "request",
        entityId: request.id,
        changes: { serviceType, location, preferredDate, patientId: patientId || null },
    });

    // Auto-persist custom visit type and EMR values to the lookup table
    if (visitType) await ensureOption("visit_type", visitType);
    if (emr) await ensureOption("emr", emr);

    // Notify matching therapists (fire-and-forget)
    if (request.latitude && request.longitude) {
        const workAreas = await prisma.workArea.findMany({
            include: { therapist: { include: { user: { select: { email: true } } } } },
        });

        const matchingTherapists = [];
        const seen = new Set();
        for (const area of workAreas) {
            if (seen.has(area.therapistId)) continue;
            const distance = haversineDistance(
                parseFloat(request.latitude), parseFloat(request.longitude),
                parseFloat(area.latitude), parseFloat(area.longitude)
            );
            if (distance <= area.radiusMiles) {
                seen.add(area.therapistId);
                matchingTherapists.push(area.therapist);
            }
        }

        if (matchingTherapists.length > 0) {
            sendNewRequestNotifications({
                therapists: matchingTherapists,
                request,
                customer: customerProfile,
            }).catch(() => { });
        }
    }

    return request;
}

export const getCustomerRequests = async (customerId) => {
    const requests = await prisma.therapyRequest.findMany({
        where: { customerId },
        include: {
            offers: { include: { therapist: true } },
            patient: {
                select: { id: true, fullName: true, email: true, phone: true }
            },
        },
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
                    ? { therapistId: user.therapistProfile.id }
                    : undefined,
                include: { therapist: true, },
                orderBy: { createdAt: "desc" }
            },
            patient: {
                select: { id: true, fullName: true, email: true, phone: true }
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
        include: {
            customer: true,
            patient: { select: { id: true, fullName: true, email: true, phone: true } },
            offers: { where: { therapistId } },
        },
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