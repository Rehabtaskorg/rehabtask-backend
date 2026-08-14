import { OFFER_STATUS, BOOKING_STATUS } from "../utils/constants.js";
import { THERAPIST_SAFE_SELECT } from "../utils/therapistContactAccess.js";
import { prisma } from "../config/prisma.js";
import { addHours } from "date-fns";
import {
    sendNewOfferNotification,
    sendOfferDeclined,
    sendOfferWithdrawn,
    sendOfferChangeRequested
} from "./email.service.js";
import { logger } from "../config/logger.js";
import { logAction } from "./audit.service.js";
import { findOrCreateDirectConversation, createSystemMessage } from "./message.service.js";
import { smsCustOfferReceived } from "./sms.service.js";
export { acceptOffer } from "./offer.acceptance.service.js";

/**
 * Create offer
 */
export const createOffer = async (therapistId, data) => {
    const {
        requestId, rate, sessionType, proposedDate, description, visitTypeId,
        attemptedVisitRate,
        visitType, visitsPerWeek, numberOfWeeks,
    } = data;

    const request = await prisma.therapyRequest.findUnique({ where: { id: requestId } });

    if (!request) {
        throw new Error("Request not found");
    }

    if (!["created", "offers_received"].includes(request.status)) {
        throw new Error("Request is no longer accepting offers");
    }

    // Direct requests are private — only the designated therapist may submit an offer
    if (request.requestType === "DIRECT" && request.targetTherapistId !== therapistId) {
        throw new Error("This request is private and not available to you");
    }

    // Check if therapist already made an offer
    const existingOffer = await prisma.offer.findFirst({
        where: {
            requestId,
            therapistId,
            status: { in: [OFFER_STATUS.PENDING, OFFER_STATUS.ACCEPTED, OFFER_STATUS.CHANGE_REQUESTED] },
        },
    });

    if (existingOffer) {
        logger.error("[OfferService] Duplicate offer attempt blocked", { therapistId, requestId, existingOfferId: existingOffer.id });
        throw new Error("You have already made an offer for this request");
    }


    let resolvedAttemptedVisitRate;
    if (attemptedVisitRate === undefined) {
        const therapistProfile = await prisma.therapistProfile.findUnique({
            where: { id: therapistId },
            select: { attemptedVisitRate: true },
        });
        resolvedAttemptedVisitRate = therapistProfile?.attemptedVisitRate != null
            ? parseFloat(therapistProfile.attemptedVisitRate)
            : null;
    } else {
        resolvedAttemptedVisitRate = attemptedVisitRate;
    }

    if (resolvedAttemptedVisitRate != null && resolvedAttemptedVisitRate > rate) {
        resolvedAttemptedVisitRate = rate;
    }

    const expiresAt = addHours(new Date(), parseInt(process.env.OFFER_EXPIRY_HOURS || "48", 10));

    const offer = await prisma.offer.create({
        data: {
            requestId,
            therapistId,
            rate,
            sessionType,
            proposedDate: new Date(proposedDate),
            description,
            status: BOOKING_STATUS.PENDING,
            expiresAt,
            attemptedVisitRate: resolvedAttemptedVisitRate,
            ...(visitTypeId && { visitTypeId }),
            ...(visitType != null && { visitType }),
            ...(visitsPerWeek != null && { visitsPerWeek }),
            ...(numberOfWeeks != null && { numberOfWeeks }),
        },
        include: {
            visitTypeRef: true,
            therapist: { select: { ...THERAPIST_SAFE_SELECT, userId: true, phone: true, user: { select: { id: true } } } },
            request: {
                include: {
                    visitTypeRef: true,
                    customer: {
                        include: { user: { select: { id: true, email: true } } },
                    },
                    patient: {
                        select: { id: true, fullName: true, email: true, phone: true }
                    },
                },
            },
        },
    });

    // Update request status to offers_received
    await prisma.therapyRequest.update({
        where: { id: requestId },
        data: { status: "offers_received" },
    });

    // Event: offer.sent
    logAction({
        actorId: offer.therapist.userId,
        action: "offer.sent",
        entityType: "offer",
        entityId: offer.id,
        changes: { requestId, rate, sessionType, proposedDate },
    });

    // Dual-write: insert "offer_sent" system message into the DirectConversation
    // so the unified thread shows this event. Fire-and-forget — don't block offer creation.
    const therapistUserId = offer.therapist.userId;
    const customerUserId = offer.request.customer.user.id;
    findOrCreateDirectConversation(therapistUserId, customerUserId, offer.request.patientId || null)
        .then((conversation) =>
            createSystemMessage({
                conversationId: conversation.id,
                actorId: therapistUserId,
                recipientId: customerUserId,
                content: `Offer sent — $${parseFloat(offer.rate)}/${offer.sessionType || "session"}`,
                systemType: "offer_sent",
                offerId: offer.id,
                patientId: offer.request.patientId || null,
            })
        )
        .catch((err) => {
            logger.error("[OfferService] System message (offer_sent) failed", { error: err.message, offerId: offer.id });
        });

    // Notify customer about the new offer (fire-and-forget)
    sendNewOfferNotification({
        customer: offer.request.customer,
        therapist: offer.therapist,
        offer,
        request: offer.request
    }).catch((err) => {
        logger.error('[OfferService] New offer notification failed', { error: err.message });
    });
    smsCustOfferReceived(offer.request.customer, offer.requestId);

    return offer;
}

/**
 * Get therapist's offers
 */
export const getTherapistOffers = async (therapistId) => {
    const offers = await prisma.offer.findMany({
        where: { therapistId },
        include: {
            visitTypeRef: true,
            request: {
                include: {
                    visitTypeRef: true,
                    customer: true,
                    patient: {
                        select: { id: true, fullName: true, email: true, phone: true }
                    },
                },
            },
        },
        orderBy: { createdAt: "desc" },
    });

    return offers;
}

/**
 * Get a single offer by ID with therapist access check
 * Uses by the messages page offer widget
 * @param {string} offerId - UUID of the offer
 * @param {string} userId - UUID of the authenticated user
 */
export const getOfferById = async (offerId, userId) => {
    const offer = await prisma.offer.findUnique({
        where: { id: offerId },
        include: {
            visitTypeRef: true,
            request: {
                include: {
                    visitTypeRef: true,
                    customer: {
                        select: {
                            id: true, userId: true, fullName: true, customerType: true,
                            agencyName: true, phone: true, billingEmail: true,
                        },
                    },
                    patient: {
                        select: { id: true, fullName: true, email: true, phone: true }
                    },
                },
            },
            therapist: { select: { ...THERAPIST_SAFE_SELECT, userId: true, phone: true } },
        }
    });

    if (!offer) {
        const err = new Error("Offer not found");
        err.statusCode = 404;
        throw err;
    }

    // Access check: the authenticated user must be either the therapist or the customer on this offer
    const isTherapist = offer.therapist.userId === userId;
    const isCustomer = offer.request.customer.userId === userId;

    if (!isTherapist && !isCustomer) {
        const err = new Error("Forbidden");
        err.statusCode = 403;
        throw err;
    }

    return offer;
}

/**
 * Revise an offer that has status "change_requested"
 */
export const reviseOffer = async (therapistId, offerId, data) => {
    const {
        rate, sessionType, proposedDate, description, visitTypeId,
        attemptedVisitRate,
        visitType, visitsPerWeek, numberOfWeeks,
    } = data;

    const existing = await prisma.offer.findUnique({
        where: { id: offerId },
    });

    if (!existing) {
        throw new Error("Offer not found");
    }

    if (existing.therapistId !== therapistId) {
        throw new Error("You are not authorized to revise this offer");
    }

    if (existing.status !== OFFER_STATUS.CHANGE_REQUESTED) {
        throw new Error("This offer cannot be revised in its current state");
    }

    // Reset expiry from now
    const expiresAt = addHours(new Date(), parseInt(process.env.OFFER_EXPIRY_HOURS || "48", 10));

    let nextAttemptedVisitRate;
    let attemptedRateWasCapped = false;
    if (attemptedVisitRate === undefined) {
        const existingAttempted = existing.attemptedVisitRate != null
            ? parseFloat(existing.attemptedVisitRate)
            : null;
        if (existingAttempted != null && existingAttempted > rate) {
            nextAttemptedVisitRate = rate;
            attemptedRateWasCapped = true;
        } else {
            nextAttemptedVisitRate = undefined;
        }
    } else if (attemptedVisitRate === null) {
        nextAttemptedVisitRate = null;
    } else {
        if (attemptedVisitRate > rate) {
            nextAttemptedVisitRate = rate;
            attemptedRateWasCapped = true;
        } else {
            nextAttemptedVisitRate = attemptedVisitRate;
        }
    }

    const updated = await prisma.offer.update({
        where: { id: offerId },
        data: {
            rate,
            sessionType,
            proposedDate: new Date(proposedDate),
            description,
            status: BOOKING_STATUS.PENDING,
            expiresAt,
            changeRequestNote: null,
            ...(nextAttemptedVisitRate !== undefined && { attemptedVisitRate: nextAttemptedVisitRate }),
            ...(visitTypeId !== undefined && { visitTypeId }),
            ...(visitType !== undefined && { visitType }),
            ...(visitsPerWeek !== undefined && { visitsPerWeek }),
            ...(numberOfWeeks !== undefined && { numberOfWeeks }),
        },
        include: {
            visitTypeRef: true,
            therapist: { select: { ...THERAPIST_SAFE_SELECT, userId: true, phone: true } },
            request: {
                include: {
                    visitTypeRef: true,
                    customer: {
                        include: { user: { select: { id: true, email: true } } },
                    },
                }
            }
        }
    });

    // Event: offer.updated
    logAction({
        actorId: updated.therapist.userId,
        action: "offer.updated",
        entityType: "offer",
        entityId: offerId,
        changes: { rate, sessionType, proposedDate, previousStatus: OFFER_STATUS.CHANGE_REQUESTED },
    });

    // System message: offer_revised
    const reviseCustomerUserId = updated.request.customer.user.id;
    const reviseTherapistUserId = updated.therapist.userId;
    findOrCreateDirectConversation(reviseTherapistUserId, reviseCustomerUserId, updated.request.patientId || null)
        .then((conversation) =>
            createSystemMessage({
                conversationId: conversation.id,
                actorId: reviseTherapistUserId,
                recipientId: reviseCustomerUserId,
                content: `Offer revised — $${parseFloat(updated.rate)}/${updated.sessionType || "session"}`,
                systemType: "offer_revised",
                offerId,
                patientId: updated.request.patientId || null,
            })
        )
        .catch((err) => {
            logger.error("[OfferService] System message (offer_revised) failed", { error: err.message });
        });

    // Notify customer about the revised offer (fire-and-forget)
    sendNewOfferNotification({
        customer: updated.request.customer,
        therapist: updated.therapist,
        offer: updated,
        request: updated.request,
    }).catch((err) => {
        logger.error("[OfferService] Revised offer notification failed", {
            error: err.message,
        });
    });

    const warnings = [];
    if (attemptedRateWasCapped) {
        const cappedTo = updated.attemptedVisitRate != null
            ? parseFloat(updated.attemptedVisitRate).toFixed(2)
            : parseFloat(rate).toFixed(2);
        warnings.push(`Attempted visit rate was reduced to $${cappedTo} to match your new session rate.`);
    }

    return { offer: updated, warnings };
}

/**
 * Decline an offer (customer)
 */
export const declineOffer = async (offerId, customerId) => {
    const offer = await prisma.offer.findUnique({
        where: { id: offerId },
        include: {
            request: true,
            therapist: {
                include: { user: { select: { id: true, email: true } } }
            },
        },
    });

    if (!offer) {
        const err = new Error("Offer not found");
        err.statusCode = 404;
        throw err;
    }

    if (offer.request.customerId !== customerId) {
        const err = new Error("Unauthorized");
        err.statusCode = 403;
        throw err;
    }

    if (offer.status !== OFFER_STATUS.PENDING) {
        throw new Error("Only pending offers can be declined");
    }

    if (new Date() > new Date(offer.expiresAt)) {
        throw new Error("Offer has expired");
    }

    const updatedOffer = await prisma.offer.update({
        where: { id: offerId },
        data: { status: OFFER_STATUS.REJECTED },
        include: {
            therapist: {
                include: { user: { select: { id: true, email: true } } }
            },
            request: {
                include: {
                    customer: {
                        include: { user: { select: { id: true, email: true } } }
                    },
                },
            },
        },
    });

    // Event: offer.rejected_by_customer
    logAction({
        actorId: updatedOffer.request.customer.user.id,
        action: "offer.rejected_by_customer",
        entityType: "offer",
        entityId: offerId,
        changes: { therapistId: updatedOffer.therapist.id, requestId: updatedOffer.request.id },
    });

    // System message: offer_declined
    const declineCustomerUserId = updatedOffer.request.customer.user.id;
    const declineTherapistUserId = updatedOffer.therapist.user.id;
    findOrCreateDirectConversation(declineCustomerUserId, declineTherapistUserId, updatedOffer.request.patientId || null)
        .then((conversation) =>
            createSystemMessage({
                conversationId: conversation.id,
                actorId: declineCustomerUserId,
                recipientId: declineTherapistUserId,
                content: "Offer declined by patient.",
                systemType: "offer_declined",
                offerId,
                patientId: updatedOffer.request.patientId || null,
            })
        )
        .catch((err) => {
            logger.error("[OfferService] System message (offer_declined) failed", { error: err.message });
        });

    sendOfferDeclined({
        therapist: updatedOffer.therapist,
        customer: updatedOffer.request.customer,
        offer: updatedOffer
    }).catch((err) => {
        logger.error('[OfferService] Offer declined notification failed', { error: err.message });
    });

    return updatedOffer;
}

/**
 * Request change to offer (customer)
 */
export const requestOfferChange = async (offerId, customerId, note) => {
    const offer = await prisma.offer.findUnique({
        where: { id: offerId },
        include: {
            request: {
                include: {
                    customer: {
                        include: { user: { select: { id: true, email: true } } }
                    },
                },
            },
            therapist: {
                include: { user: { select: { id: true, email: true } } }
            },
        },
    });

    if (!offer) {
        const err = new Error("Offer not found");
        err.statusCode = 404;
        throw err;
    }

    if (offer.request.customerId !== customerId) {
        const err = new Error("Unauthorized");
        err.statusCode = 403;
        throw err;
    }

    if (offer.status !== OFFER_STATUS.PENDING) {
        throw new Error("Only pending offers can have changes requested");
    }

    if (new Date() > new Date(offer.expiresAt)) {
        throw new Error("Offer has expired. Cannot request changes after expiration.");
    }

    const updatedOffer = await prisma.offer.update({
        where: { id: offerId },
        data: {
            status: OFFER_STATUS.CHANGE_REQUESTED,
            changeRequestNote: note,
        }
    });

    // System message: offer_change_requested
    const changeCustomerUserId = offer.request.customer.user.id;
    const changeTherapistUserId = offer.therapist.user.id;
    findOrCreateDirectConversation(changeCustomerUserId, changeTherapistUserId, offer.request.patientId || null)
        .then((conversation) =>
            createSystemMessage({
                conversationId: conversation.id,
                actorId: changeCustomerUserId,
                recipientId: changeTherapistUserId,
                content: `Patient requested changes: ${note}`,
                systemType: "offer_change_requested",
                offerId,
                patientId: offer.request.patientId || null,
            })
        )
        .catch((err) => {
            logger.error("[OfferService] System message (offer_change_requested) failed", { error: err.message });
        });

    sendOfferChangeRequested({
        therapist: offer.therapist,
        customer: offer.request.customer,
        offer,
        note,
    }).catch((err) => {
        logger.error('[OfferService] Change request notification failed', { error: err.message });
    });

    return updatedOffer;
}

/**
 * Withdraw an offer (therapist)
 */
export const withdrawOffer = async (offerId, therapistId) => {
    const offer = await prisma.offer.findUnique({
        where: { id: offerId },
        include: {
            request: {
                include: {
                    customer: {
                        include: { user: { select: { id: true, email: true } } }
                    },
                },
            },
            therapist: { select: { ...THERAPIST_SAFE_SELECT, userId: true, phone: true, smsOptIn: true } },
        },
    });

    if (!offer) {
        const err = new Error("Offer not found");
        err.statusCode = 404;
        throw err;
    }

    if (offer.therapistId !== therapistId) {
        const err = new Error("Unauthorized");
        err.statusCode = 403;
        throw err;
    }

    if (![OFFER_STATUS.PENDING, OFFER_STATUS.CHANGE_REQUESTED].includes(offer.status)) {
        throw new Error("Only pending or change-requested offers can be withdrawn");
    }

    const updatedOffer = await prisma.offer.update({
        where: { id: offerId },
        data: {
            status: "withdrawn",
            withdrawnAt: new Date(),
        },
    });

    // Event: offer.withdrawn (therapist withdrew their offer)
    logAction({
        actorId: offer.therapist.userId,
        action: "offer.withdrawn",
        entityType: "offer",
        entityId: offerId,
        changes: { requestId: offer.requestId, previousStatus: offer.status },
    });

    // System message: offer_withdrawn
    const withdrawCustomerUserId = offer.request.customer.user.id;
    const withdrawTherapistUserId = offer.therapist.userId;
    findOrCreateDirectConversation(withdrawCustomerUserId, withdrawTherapistUserId, offer.request.patientId || null)
        .then((conversation) =>
            createSystemMessage({
                conversationId: conversation.id,
                actorId: withdrawTherapistUserId,
                recipientId: withdrawCustomerUserId,
                content: "Offer withdrawn by therapist.",
                systemType: "offer_withdrawn",
                offerId,
                patientId: offer.request.patientId || null,
            })
        )
        .catch((err) => {
            logger.error("[OfferService] System message (offer_withdrawn) failed", { error: err.message });
        });

    sendOfferWithdrawn({
        customer: offer.request.customer,
        therapist: offer.therapist,
        offer
    }).catch((err) => {
        logger.error('[OfferService] Offer withdrawn notification failed', { error: err.message });
    });

    return updatedOffer;
}