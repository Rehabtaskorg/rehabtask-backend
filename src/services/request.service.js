import { APPROVAL_STATUS, OFFER_STATUS, TIME_MS, BOOKING_STATUS, CUSTOMER_TYPES, LICENSE_TYPE_TO_SERVICE_TYPE } from "../utils/constants.js";
import { prisma } from "../config/prisma.js";
import { haversineDistance } from "../utils/distance.js";
import { ensureOption } from "./requestOption.service.js";
import { sendNewRequestNotifications, sendOffersWithdrawnRequestUpdated, sendDirectRequestNotification } from "./email.service.js";
import { logger } from "../config/logger.js";
import { logAction } from "./audit.service.js";
import { geocodeAddress, assertCoherenceOrLog } from "./geocoding.service.js";
import { NotFoundError, BadRequestError } from "../utils/errors.js";

export const createRequest = async (customerId, data, customerProfile) => {
    const {
        serviceType, description, preferredDate, location, latitude, longitude,
        patientId, rate, visitType, visitTypeId, emr, visitsPerWeek, numberOfWeeks,
        requestType = "PUBLIC", targetTherapistId,
    } = data;

    // IF patientId is provided, validate the patient belongs to this agency
    if (patientId) {
        if (customerProfile?.customerType !== CUSTOMER_TYPES.AGENCY) {
            throw new Error("Only agency accounts can assign requests to patients");
        }

        const patient = await prisma.patient.findFirst({
            where: { id: patientId, agencyId: customerProfile.id, isActive: true }
        });
        if (!patient) {
            throw new Error("Patient not found or does not belong to your agency");
        }
    }

    // For direct requests, verify the target therapist exists and is approved.
    // Fetch fullName and user email here so we can notify them after the request is created.
    let directTargetTherapist = null;
    if (requestType === "DIRECT") {
        directTargetTherapist = await prisma.therapistProfile.findUnique({
            where: { id: targetTherapistId },
            select: {
                id: true,
                fullName: true,
                approvalStatus: true,
                user: { select: { email: true } },
            },
        });
        if (!directTargetTherapist) throw new NotFoundError("Target therapist not found");
        if (directTargetTherapist.approvalStatus !== APPROVAL_STATUS.APPROVED) throw new BadRequestError("Target therapist is not available");
    }

    const geocoded = await geocodeAddress(location);
    assertCoherenceOrLog("request.create", latitude, longitude, geocoded.latitude, geocoded.longitude, 5);

    const request = await prisma.therapyRequest.create({
        data: {
            customerId,
            serviceType,
            description,
            preferredDate: new Date(preferredDate),
            location: geocoded.formattedAddress,
            latitude: geocoded.latitude,
            longitude: geocoded.longitude,
            status: "created",
            requestType,
            ...(patientId && { patientId }),
            ...(rate != null && { rate }),
            ...(visitTypeId && { visitTypeId }),
            ...(!visitTypeId && visitType && { visitType }),
            ...(emr && { emr }),
            ...(visitsPerWeek != null && { visitsPerWeek }),
            ...(numberOfWeeks != null && { numberOfWeeks }),
            ...(requestType === "DIRECT" && targetTherapistId && { targetTherapistId }),
        },
    });

    // Event: request.created
    logAction({
        actorId: customerProfile.userId,
        action: "request.created",
        entityType: "request",
        entityId: request.id,
        changes: {
            serviceType, location, preferredDate,
            patientId: patientId || null,
            requestType,
            targetTherapistId: targetTherapistId || null,
        },
    });

    // Auto-persist EMR and legacy string visit_type values to the lookup table.
    if (!visitTypeId && visitType) await ensureOption("visit_type", visitType);
    if (emr) await ensureOption("emr", emr);

    // Notify the targeted therapist — ONLY for direct requests (fire-and-forget, non-blocking)
    if (requestType === "DIRECT" && directTargetTherapist) {
        sendDirectRequestNotification({
            therapist: directTargetTherapist,
            request,
        }).catch((err) => logger.error("[RequestService] Failed to send direct request notification", { error: err.message }));
    }

    if (requestType === "PUBLIC" && request.latitude && request.longitude) {
        const workAreas = await prisma.workArea.findMany({
            include: {
                therapist: {
                    select: { fullName: true, primaryLicenseType: true, user: { select: { email: true } } },
                },
            },
        });

        const matchingTherapists = [];
        const seen = new Set();
        for (const area of workAreas) {
            if (seen.has(area.therapistId)) continue;
            const allowedServiceType = LICENSE_TYPE_TO_SERVICE_TYPE[area.therapist.primaryLicenseType] ?? null;
            if (allowedServiceType !== request.serviceType) continue;
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

export const getCustomerRequests = async (customerId, { status, serviceType, page = 1, limit = 20 } = {}) => {
    const where = { customerId };

    if (status) {
        where.status = status;
    }
    if (serviceType) {
        where.serviceType = { equals: serviceType, mode: "insensitive" };
    }

    const [requests, total] = await Promise.all([
        prisma.therapyRequest.findMany({
            where,
            include: {
                visitTypeRef: true,
                offers: { include: { therapist: true, visitTypeRef: true } },
                patient: {
                    select: { id: true, fullName: true, email: true, phone: true }
                },
            },
            orderBy: { createdAt: "desc" },
            skip: (page - 1) * limit,
            take: limit,
        }),
        prisma.therapyRequest.count({ where }),
    ]);

    return {
        requests,
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
}

export const getRequestById = async (requestId, userId) => {
    const user = await prisma.user.findUnique({
        where: { id: userId },
        include: { therapistProfile: true, customerProfile: true }
    });

    const request = await prisma.therapyRequest.findUnique({
        where: { id: requestId },
        include: {
            visitTypeRef: true,
            customer: { include: { user: true } },
            offers: {
                where: user?.therapistProfile
                    ? { therapistId: user.therapistProfile.id }
                    : undefined,
                include: { therapist: true, visitTypeRef: true },
                orderBy: { createdAt: "desc" }
            },
            patient: {
                select: { id: true, fullName: true, email: true, phone: true }
            },
        },
    });

    if (!request) throw new Error("Request not found");

    const isCustomer = request.customer.userId === userId;
    const isTargetTherapist = user?.therapistProfile?.id === request.targetTherapistId;
    const allowedServiceType = LICENSE_TYPE_TO_SERVICE_TYPE[user?.therapistProfile?.primaryLicenseType] ?? null;
    const isPublicAndTherapist = request.requestType === "PUBLIC"
        && !!user?.therapistProfile
        && allowedServiceType === request.serviceType;
    const canView = isCustomer || isTargetTherapist || isPublicAndTherapist;

    // Use a generic error to avoid leaking the existence of private requests
    if (!canView) throw new Error("Request not found");

    return request;
}

// GEO-FILTERED: Only return requests within the therapist's work area radii
export const getAvailableRequests = async (therapistId, { primaryLicenseType, show, visitTypeIds, radiusMiles, page = 1, limit = 20 } = {}) => {
    // Fetch therapist's work areas
    const workAreas = await prisma.workArea.findMany({
        where: { therapistId },
    });

    // If therapist hasn't set up work areas, return empty array
    if (!workAreas || workAreas.length === 0) {
        return { requests: [], pagination: { page, limit, total: 0, totalPages: 0 } };
    }

    // Resolve the allowed service type from the therapist's license type.
    // Falls back to null if the license type is unrecognised — in that case
    // the PUBLIC branch is omitted entirely (safe default: show nothing).
    const allowedServiceType = primaryLicenseType
        ? (LICENSE_TYPE_TO_SERVICE_TYPE[primaryLicenseType] ?? null)
        : null;

    // Build where clause with server-side filters.
    // PUBLIC requests are filtered to the therapist's own discipline.
    // DIRECT requests bypass the discipline filter — the customer chose this
    // therapist specifically, so we always show it regardless of service type.
    const publicFilter = allowedServiceType
        ? { requestType: "PUBLIC", serviceType: allowedServiceType }
        : null;

    const where = {
        status: { in: ["created", "offers_received"] },
        OR: [
            ...(publicFilter ? [publicFilter] : []),
            { requestType: "DIRECT", targetTherapistId: therapistId },
        ],
        NOT: {
            offers: {
                some: {
                    therapistId,
                    status: OFFER_STATUS.REJECTED,
                },
            },
        },
        ...(visitTypeIds?.length > 0 && { visitTypeId: { in: visitTypeIds } }),
    };

    // Fetch all matching requests (geo-filter requires post-query)
    const requests = await prisma.therapyRequest.findMany({
        where,
        include: {
            visitTypeRef: true,
            customer: true,
            patient: { select: { id: true, fullName: true, email: true, phone: true } },
            offers: { where: { therapistId }, include: { visitTypeRef: true } },
        },
        orderBy: { createdAt: "desc" },
    });

    // Filter by work area radius — radiusMiles, if provided, extends (never shrinks) each area's configured radius
    // DIRECT requests bypass geo-filtering — the customer explicitly chose this therapist regardless of location
    let filteredRequests = requests.filter((request) => {
        if (request.requestType === "DIRECT") return true;
        const requestLat = parseFloat(request.latitude);
        const requestLng = parseFloat(request.longitude);
        return workAreas.some((area) => {
            const areaLat = parseFloat(area.latitude);
            const areaLng = parseFloat(area.longitude);
            const distance = haversineDistance(requestLat, requestLng, areaLat, areaLng);
            const effectiveRadius = radiusMiles ? Math.max(area.radiusMiles, radiusMiles) : area.radiusMiles;
            return distance <= effectiveRadius;
        });
    });

    // Server-side "show" filter
    if (show === "new") {
        const cutoff = new Date(Date.now() - TIME_MS.TWENTY_FOUR_HOURS);
        filteredRequests = filteredRequests.filter((r) => new Date(r.createdAt) > cutoff);
    } else if (show === "my_offers") {
        filteredRequests = filteredRequests.filter((r) => r.offers?.length > 0);
    }

    // Paginate the geo-filtered results
    const total = filteredRequests.length;
    const start = (page - 1) * limit;
    const paginatedRequests = filteredRequests.slice(start, start + limit);

    return {
        requests: paginatedRequests,
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
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
                where: { status: { in: [OFFER_STATUS.PENDING, OFFER_STATUS.CHANGE_REQUESTED] } },
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
    if (data.location !== undefined) {
        const geocoded = await geocodeAddress(data.location);
        assertCoherenceOrLog("request.update", data.latitude, data.longitude, geocoded.latitude, geocoded.longitude, 5);
        updateData.location = geocoded.formattedAddress;
        updateData.latitude = geocoded.latitude;
        updateData.longitude = geocoded.longitude;
    }
    if (data.rate !== undefined) updateData.rate = data.rate;
    // Visit type: prefer FK, keep legacy string as backup during transition window.
    // If the client sends visitTypeId, we also clear the string so there's no drift
    // between the two sources.
    if (data.visitTypeId !== undefined) {
        updateData.visitTypeId = data.visitTypeId;
        if (data.visitTypeId) updateData.visitType = null;
    }
    if (data.visitType !== undefined && data.visitTypeId === undefined) {
        updateData.visitType = data.visitType;
    }
    if (data.emr !== undefined) updateData.emr = data.emr;
    if (data.visitsPerWeek !== undefined) updateData.visitsPerWeek = data.visitsPerWeek || null;
    if (data.numberOfWeeks !== undefined) updateData.numberOfWeeks = data.numberOfWeeks || null;

    const hasActiveOffers = existing.offers.length > 0;

    // Use a transaction to atomically update request + withdraw offers
    const updatedRequest = await prisma.$transaction(async (tx) => {
        // If offers exist, withdraw them all — the request terms have changed
        if (hasActiveOffers) {
            await tx.offer.updateMany({
                where: {
                    requestId,
                    status: { in: [OFFER_STATUS.PENDING, OFFER_STATUS.CHANGE_REQUESTED] },
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
    }, { timeout: 10000 });

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

    // Auto-persist EMR and legacy visit_type string values.
    if (!data.visitTypeId && data.visitType) await ensureOption("visit_type", data.visitType);
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
            include: {
                therapist: {
                    select: { fullName: true, primaryLicenseType: true, user: { select: { email: true } } },
                },
            },
        });

        const matchingTherapists = [];
        const seen = new Set();
        for (const area of workAreas) {
            if (seen.has(area.therapistId)) continue;
            const allowedServiceType = LICENSE_TYPE_TO_SERVICE_TYPE[area.therapist.primaryLicenseType] ?? null;
            if (allowedServiceType !== updatedRequest.serviceType) continue;
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
                where: { status: { in: [OFFER_STATUS.PENDING, OFFER_STATUS.CHANGE_REQUESTED] } },
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
                    status: { in: [OFFER_STATUS.PENDING, OFFER_STATUS.CHANGE_REQUESTED] },
                },
                data: {
                    status: "withdrawn",
                    withdrawnAt: new Date(),
                },
            });
        }

        return tx.therapyRequest.update({
            where: { id: requestId },
            data: { status: BOOKING_STATUS.CANCELLED },
        });
    }, { timeout: 10000 });

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

/**
 * Get open requests for a specific customer (therapist-facing).
 * Used in the messaging sidebar so therapists can view and make offers
 * on a customer's requests directly from the chat.
 * PUBLIC requests are geo-filtered to the therapist's work areas.
 * DIRECT requests addressed to this therapist always appear regardless of location.
 */
export const getOpenRequestsByCustomerUserId = async (customerUserId, therapistId, primaryLicenseType) => {
    const [customerProfile, workAreas] = await Promise.all([
        prisma.customerProfile.findFirst({
            where: { userId: customerUserId },
            select: { id: true },
        }),
        prisma.workArea.findMany({ where: { therapistId } }),
    ]);

    if (!customerProfile) return [];

    const allowedServiceType = primaryLicenseType
        ? (LICENSE_TYPE_TO_SERVICE_TYPE[primaryLicenseType] ?? null)
        : null;

    const publicFilter = allowedServiceType
        ? { requestType: "PUBLIC", serviceType: allowedServiceType }
        : null;

    const requests = await prisma.therapyRequest.findMany({
        where: {
            customerId: customerProfile.id,
            status: { in: ["created", "offers_received"] },
            OR: [
                ...(publicFilter ? [publicFilter] : []),
                { requestType: "DIRECT", targetTherapistId: therapistId },
            ],
        },
        include: {
            patient: { select: { id: true, fullName: true } },
            offers: {
                where: { therapistId },
                select: { id: true, status: true },
            },
        },
        orderBy: { createdAt: "desc" },
        take: 5,
    });

    const filtered = requests.filter((request) => {
        if (request.requestType === "DIRECT") return true;
        if (workAreas.length === 0) return false;
        const requestLat = parseFloat(request.latitude);
        const requestLng = parseFloat(request.longitude);
        return workAreas.some((area) => {
            const distance = haversineDistance(requestLat, requestLng, parseFloat(area.latitude), parseFloat(area.longitude));
            return distance <= area.radiusMiles;
        });
    });

    return filtered.map(r => ({
        id: r.id,
        serviceType: r.serviceType,
        location: r.location,
        preferredDate: r.preferredDate,
        status: r.status,
        patient: r.patient,
        myOffer: r.offers[0] ?? null,
        createdAt: r.createdAt,
    }));
}

/**
 * Mark the TherapyRequest linked to a booking as completed.
 *
 * Called after a booking reaches a terminal state (COMPLETED or FINALIZED).
 * Resolves the requestId via the booking's offer — one extra DB read, but
 * isolated here so all 5 finalization paths share a single implementation.
 *
 * Idempotent: skips the update if the request is already completed or cancelled.
 *
 * @param {string} bookingId
 * @returns {Promise<void>}
 */
export const markLinkedRequestCompleted = async (bookingId) => {
    const booking = await prisma.booking.findUnique({
        where: { id: bookingId },
        select: { offer: { select: { requestId: true } } },
    });

    const requestId = booking?.offer?.requestId;
    if (!requestId) {
        logger.warn("[RequestService] markLinkedRequestCompleted: no requestId found for booking", { bookingId });
        return;
    }

    await prisma.therapyRequest.updateMany({
        where: {
            id: requestId,
            status: { notIn: ["completed", "cancelled"] },
        },
        data: { status: "completed" },
    });
}