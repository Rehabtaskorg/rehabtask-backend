import { prisma } from "../config/prisma.js";
import { addHours, addMinutes } from "date-fns";
import {
    sendNewOfferNotification,
    sendOfferAccepted,
    sendOfferDeclined,
    sendOfferWithdrawn,
    sendOfferChangeRequested
} from "./email.service.js";
import { logger } from "../config/logger.js";
import { logAction } from "./audit.service.js";
import { findOrCreateDirectConversation, createSystemMessage } from "./message.service.js";
import { resolveVisitPlan } from "../utils/visitPlan.js";

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
            status: { in: ["pending", "accepted", "change_requested"] },
        },
    });

    if (existingOffer) {
        console.error(`[Offer duplicate check] therapistId=${therapistId} requestId=${requestId} matched existingOfferId=${existingOffer.id}`);
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
            status: "pending",
            expiresAt,
            attemptedVisitRate: resolvedAttemptedVisitRate,
            ...(visitTypeId && { visitTypeId }),
            ...(visitType != null && { visitType }),
            ...(visitsPerWeek != null && { visitsPerWeek }),
            ...(numberOfWeeks != null && { numberOfWeeks }),
        },
        include: {
            visitTypeRef: true,
            therapist: true,
            request: {
                include: {
                    visitTypeRef: true,
                    customer: {
                        include: { user: { select: { id: true, email: true } } }
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
    findOrCreateDirectConversation(therapistUserId, customerUserId)
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
    })

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
                    customer: true,
                    patient: {
                        select: { id: true, fullName: true, email: true, phone: true }
                    },
                },
            },
            therapist: true,
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
 * Accept offer (customer)
 */
export const acceptOffer = async (offerId, customerId) => {
    // Validate offer exists and belongs to this customer before starting transaction.
    // Include visitTypeRef on both offer and request so resolveVisitPlan can pull
    // the FK-loaded catalog row during copy-on-accept.
    const offer = await prisma.offer.findUnique({
        where: { id: offerId },
        include: {
            visitTypeRef: true,
            request: {
                include: { visitTypeRef: true },
            },
        },
    });

    if (!offer) {
        throw new Error("Offer not found");
    }

    if (offer.request.customerId !== customerId) {
        throw new Error("Unauthorized");
    }

    if (offer.status !== "pending") {
        throw new Error("Offer is no longer available");
    }

    if (new Date() > new Date(offer.expiresAt)) {
        throw new Error("Offer has expired");
    }

    const effectivePlan = resolveVisitPlan({ offer, request: offer.request });

    // All DB mutations in a single transaction to prevent partial state corruption
    const { updatedOffer, booking } = await prisma.$transaction(async (tx) => {
        // Update offer to accepted — the status check above + transaction isolation
        // prevents the TOCTOU race with the expiry cron
        const txUpdatedOffer = await tx.offer.update({
            where: { id: offerId },
            data: { status: "accepted" }
        });

        // Reject other offers for this request
        await tx.offer.updateMany({
            where: {
                requestId: offer.requestId,
                id: { not: offerId },
                status: "pending",
            },
            data: { status: "rejected" },
        });

        // Update request status
        await tx.therapyRequest.update({
            where: { id: offer.requestId },
            data: { status: "offers_accepted" }
        });

        let txBooking;
        try {
            txBooking = await tx.booking.create({
                data: {
                    offerId,
                    customerId,
                    therapistId: offer.therapistId,
                    scheduledDate: offer.proposedDate,
                    rate: offer.rate,
                    attemptedVisitRate: offer.attemptedVisitRate,
                    sessionType: offer.sessionType,
                    status: "accepted",
                    patientId: offer.request.patientId || null,
                    visitTypeId: effectivePlan.visitTypeId,
                    visitType: effectivePlan.visitType,
                    visitsPerWeek: effectivePlan.visitsPerWeek,
                    numberOfWeeks: effectivePlan.numberOfWeeks,
                },
                include: {
                    therapist: {
                        include: { user: { select: { id: true, email: true } } }
                    },
                    customer: {
                        include: { user: { select: { id: true, email: true } } }
                    },
                    offer: {
                        include: { request: true },
                    },
                },
            });
        } catch (err) {
            if (err.code === "P2002") {
                txBooking = await tx.booking.findFirst({
                    where: { offerId: offer.id },
                    include: {
                        therapist: {
                            include: { user: { select: { id: true, email: true } } }
                        },
                        customer: {
                            include: { user: { select: { id: true, email: true } } }
                        },
                        offer: {
                            include: { request: true },
                        },
                    },
                });
                if (txBooking) {
                    return { updatedOffer: txUpdatedOffer, booking: txBooking };
                }
            }
            throw err;
        }

        return { updatedOffer: txUpdatedOffer, booking: txBooking };
    });

    // Event: offer.approved_by_customer
    logAction({
        actorId: booking.customer.user.id,
        action: "offer.approved_by_customer",
        entityType: "offer",
        entityId: offerId,
        changes: { bookingId: booking.id, therapistId: offer.therapistId, rate: parseFloat(offer.rate) },
    });

    // Event: session.scheduled (booking created = session date locked)
    logAction({
        actorId: booking.customer.user.id,
        action: "session.scheduled",
        entityType: "booking",
        entityId: booking.id,
        changes: { offerId, scheduledDate: offer.proposedDate, rate: parseFloat(offer.rate) },
    });

    // Dual-write: insert "offer_accepted" + "booking_created" system messages into DirectConversation
    const acceptCustomerUserId = booking.customer.user.id;
    const acceptTherapistUserId = booking.therapist.user.id;
    findOrCreateDirectConversation(acceptCustomerUserId, acceptTherapistUserId)
        .then(async (conversation) => {
            await createSystemMessage({
                conversationId: conversation.id,
                actorId: acceptCustomerUserId,
                recipientId: acceptTherapistUserId,
                content: "Offer accepted",
                systemType: "offer_accepted",
                offerId,
                patientId: booking.offer?.request?.patientId || null,
            });
            await createSystemMessage({
                conversationId: conversation.id,
                actorId: acceptCustomerUserId,
                recipientId: acceptTherapistUserId,
                content: "Booking created. Awaiting payment.",
                systemType: "booking_created",
                bookingId: booking.id,
                patientId: booking.offer?.request?.patientId || null,
            });
        })
        .catch((err) => {
            logger.error("[OfferService] System messages (offer_accepted/booking_created) failed", { error: err.message, offerId, bookingId: booking.id });
        });

    // Email notifications stay outside the transaction (side effects)
    sendOfferAccepted({
        therapist: booking.therapist,
        customer: booking.customer,
        booking,
        offer: booking.offer
    }).catch((err) => {
        logger.error('[OfferService] Offer accepted notification failed', { error: err.message });
    })

    return { offer: updatedOffer, booking };
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

    if (existing.status !== "change_requested") {
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
            status: "pending",
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
            therapist: true,
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
        changes: { rate, sessionType, proposedDate, previousStatus: "change_requested" },
    });

    // System message: offer_revised
    const reviseCustomerUserId = updated.request.customer.user.id;
    const reviseTherapistUserId = updated.therapist.userId;
    findOrCreateDirectConversation(reviseTherapistUserId, reviseCustomerUserId)
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

    if (offer.status !== "pending") {
        throw new Error("Only pending offers can be declined");
    }

    if (new Date() > new Date(offer.expiresAt)) {
        throw new Error("Offer has expired");
    }

    const updatedOffer = await prisma.offer.update({
        where: { id: offerId },
        data: { status: "rejected" },
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
    findOrCreateDirectConversation(declineCustomerUserId, declineTherapistUserId)
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

    if (offer.status !== "pending") {
        throw new Error("Only pending offers can have changes requested");
    }

    if (new Date() > new Date(offer.expiresAt)) {
        throw new Error("Offer has expired. Cannot request changes after expiration.");
    }

    const updatedOffer = await prisma.offer.update({
        where: { id: offerId },
        data: {
            status: "change_requested",
            changeRequestNote: note,
        }
    });

    // System message: offer_change_requested
    const changeCustomerUserId = offer.request.customer.user.id;
    const changeTherapistUserId = offer.therapist.user.id;
    findOrCreateDirectConversation(changeCustomerUserId, changeTherapistUserId)
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
            therapist: true,
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

    if (!["pending", "change_requested"].includes(offer.status)) {
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
    findOrCreateDirectConversation(withdrawCustomerUserId, withdrawTherapistUserId)
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