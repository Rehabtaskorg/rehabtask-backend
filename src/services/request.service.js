import { prisma } from "../config/prisma.js";
import { haversineDistance } from "../utils/distance.js";
import { ensureOption } from "./requestOption.service.js";
import { sendNewRequestNotifications, sendOffersWithdrawnRequestUpdated } from "./email.service.js";
import { logger } from "../config/logger.js";
import { logAction } from "./audit.service.js";

export const createRequest = async (customerId, data, customerProfile) => {
    const { serviceType, description, preferredDate, location, latitude, longitude, patientId, rate, visitType, emr, visitsPerWeek, numberOfWeeks } = data;

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
            ...(visitsPerWeek != null && { visitsPerWeek }),
            ...(numberOfWeeks != null && { numberOfWeeks }),
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
            offers: { include: { therapist: true, visitType: true } },
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
                include: { therapist: true, visitType: true },
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

/**
 * Update an existing therapy request.
 * Only allowed when status is "created" or "offers_received".
 * If offers exist (offers_received), auto-withdraws all pending offers and notifies therapists.
 */
export const updateRequest = async (requestId, customerId, data, customerProfile) => {
    const existing = await prisma.therapyRequest.findUnique({
        where: { id: requestId },
        include: {
            offers: {
                where: { status: { in: ["pending", "change_requested"] } },
                include: {
                    therapist: {
                        include: { user: { select: { id: true, email: true } } }
                    },
                },
            },
            customer: {
                include: { user: { select: { id: true } } }
            },
        },
    });

    if (!existing) {
        const err = new Error("Request not found");
        err.statusCode = 404;
        throw err;
    }

    if (existing.customerId !== customerId) {
        const err = new Error("Unauthorized");
        err.statusCode = 403;
        throw err;
    }

    if (!["created", "offers_received"].includes(existing.status)) {
        const err = new Error("This request can no longer be edited");
        err.statusCode = 400;
        throw err;
    }

    // Build update payload — only include fields that were provided
    const updateData = {};
    if (data.serviceType !== undefined) updateData.serviceType = data.serviceType;
    if (data.description !== undefined) updateData.description = data.description;
    if (data.preferredDate !== undefined) updateData.preferredDate = new Date(data.preferredDate);
    if (data.location !== undefined) updateData.location = data.location;
    if (data.latitude !== undefined) updateData.latitude = data.latitude;
    if (data.longitude !== undefined) updateData.longitude = data.longitude;
    if (data.rate !== undefined) updateData.rate = data.rate;
    if (data.visitType !== undefined) updateData.visitType = data.visitType;
    if (data.emr !== undefined) updateData.emr = data.emr;

    const hasActiveOffers = existing.offers.length > 0;

    // Use a transaction to atomically update request + withdraw offers
    const updatedRequest = await prisma.$transaction(async (tx) => {
        // If offers exist, withdraw them all — the request terms have changed
        if (hasActiveOffers) {
            await tx.offer.updateMany({
                where: {
                    requestId,
                    status: { in: ["pending", "change_requested"] },
                },
                data: {
                    status: "withdrawn",
                    withdrawnAt: new Date(),
                },
            });

            // Reset status to "created" since all offers are now withdrawn
            updateData.status = "created";
        }

        return tx.therapyRequest.update({
            where: { id: requestId },
            data: updateData,
        });
    });

    // Build changes object for audit log (only changed fields)
    const changes = {};
    if (data.serviceType && data.serviceType !== existing.serviceType) changes.serviceType = { from: existing.serviceType, to: data.serviceType };
    if (data.description && data.description !== existing.description) changes.description = "updated";
    if (data.preferredDate) changes.preferredDate = data.preferredDate;
    if (data.location && data.location !== existing.location) changes.location = { from: existing.location, to: data.location };
    if (data.rate && data.rate !== parseFloat(existing.rate)) changes.rate = { from: parseFloat(existing.rate), to: data.rate };
    if (hasActiveOffers) changes.offersWithdrawn = existing.offers.length;

    // Event: request.updated
    logAction({
        actorId: existing.customer.user.id,
        action: "request.updated",
        entityType: "request",
        entityId: requestId,
        changes,
    });

    // Auto-persist custom visit type and EMR values
    if (data.visitType) await ensureOption("visit_type", data.visitType);
    if (data.emr) await ensureOption("emr", data.emr);

    // Notify withdrawn therapists (fire-and-forget)
    if (hasActiveOffers) {
        sendOffersWithdrawnRequestUpdated({
            therapists: existing.offers.map((o) => o.therapist),
            customer: customerProfile,
            request: updatedRequest,
        }).catch((err) => {
            logger.error("[RequestService] Failed to notify therapists about withdrawn offers", { error: err.message });
        });
    }

    // Re-notify matching therapists if location changed (fire-and-forget)
    const locationChanged = data.latitude && data.longitude &&
        (parseFloat(existing.latitude) !== data.latitude || parseFloat(existing.longitude) !== data.longitude);

    if (locationChanged && updatedRequest.latitude && updatedRequest.longitude) {
        const workAreas = await prisma.workArea.findMany({
            include: { therapist: { include: { user: { select: { email: true } } } } },
        });

        const matchingTherapists = [];
        const seen = new Set();
        for (const area of workAreas) {
            if (seen.has(area.therapistId)) continue;
            const distance = haversineDistance(
                parseFloat(updatedRequest.latitude), parseFloat(updatedRequest.longitude),
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
                request: updatedRequest,
                customer: customerProfile,
            }).catch(() => { });
        }
    }

    return updatedRequest;
}

/**
 * Cancel a therapy request.
 * Only allowed for requests in "created" or "offers_received" status.
 * Auto-withdraws all pending/change_requested offers and notifies therapists.
 */
export const cancelRequest = async (requestId, customerId) => {
    const existing = await prisma.therapyRequest.findUnique({
        where: { id: requestId },
        include: {
            offers: {
                where: { status: { in: ["pending", "change_requested"] } },
                include: {
                    therapist: {
                        include: { user: { select: { id: true, email: true } } }
                    },
                },
            },
            customer: {
                include: { user: { select: { id: true } } }
            },
        },
    });

    if (!existing) {
        const err = new Error("Request not found");
        err.statusCode = 404;
        throw err;
    }

    if (existing.customerId !== customerId) {
        const err = new Error("Unauthorized");
        err.statusCode = 403;
        throw err;
    }

    if (!["created", "offers_received"].includes(existing.status)) {
        const err = new Error("This request can no longer be cancelled. If you have a booking, please cancel the booking instead.");
        err.statusCode = 400;
        throw err;
    }

    const hasActiveOffers = existing.offers.length > 0;

    // Transaction: cancel request + withdraw all pending offers
    const cancelledRequest = await prisma.$transaction(async (tx) => {
        if (hasActiveOffers) {
            await tx.offer.updateMany({
                where: {
                    requestId,
                    status: { in: ["pending", "change_requested"] },
                },
                data: {
                    status: "withdrawn",
                    withdrawnAt: new Date(),
                },
            });
        }

        return tx.therapyRequest.update({
            where: { id: requestId },
            data: { status: "cancelled" },
        });
    });

    // Audit event: request.cancelled_by_customer
    logAction({
        actorId: existing.customer.user.id,
        action: "request.cancelled_by_customer",
        entityType: "request",
        entityId: requestId,
        changes: {
            status: { from: existing.status, to: "cancelled" },
            ...(hasActiveOffers ? { offersWithdrawn: existing.offers.length } : {}),
        },
    });

    // Notify withdrawn therapists (fire-and-forget)
    if (hasActiveOffers) {
        sendOffersWithdrawnRequestUpdated({
            therapists: existing.offers.map((o) => o.therapist),
            customer: existing.customer,
            request: cancelledRequest,
        }).catch((err) => {
            logger.error("[RequestService] Failed to notify therapists about cancelled request", { error: err.message });
        });
    }

    logger.info("[RequestService] Request cancelled", {
        requestId,
        customerId,
        offersWithdrawn: hasActiveOffers ? existing.offers.length : 0,
    });

    return cancelledRequest;
}