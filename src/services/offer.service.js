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

/**
 * Create offer
 */
export const createOffer = async (therapistId, data) => {
    const { requestId, rate, sessionType, proposedDate, description } = data;

    const request = await prisma.therapyRequest.findUnique({ where: { id: requestId } });

    if (!request) {
        throw new Error("Request not found");
    }

    if (!["created", "offers_received"].includes(request.status)) {
        throw new Error("Request is no longer accepting offers");
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


    // PRODUCTION: uncomment line below and remove the QA line before going live
    const expiresAt = addHours(new Date(), parseInt(process.env.OFFER_EXPIRY_HOURS || "48", 10));

    // QA Testing only - expires in 5 minutes
    // const expiresAt = addMinutes(new Date(), 5);

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
        },
        include: {
            therapist: true,
            request: {
                include: {
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
            request: {
                include: {
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
            request: {
                include: {
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
    // Validate offer exists and belongs to this customer before starting transaction
    const offer = await prisma.offer.findUnique({
        where: { id: offerId },
        include: {
            request: true,
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
                    sessionType: offer.sessionType,
                    status: "accepted",
                    patientId: offer.request.patientId || null,
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
    const { rate, sessionType, proposedDate, description } = data;

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

    const updated = await prisma.offer.update({
        where: { id: offerId },
        data: {
            rate,
            sessionType,
            proposedDate: new Date(proposedDate),
            description,
            status: "pending", // reset back to pending after revision
            expiresAt,
            changeRequestNote: null, // clear the change request note
        },
        include: {
            therapist: true,
            request: {
                include: {
                    customer: {
                        include: { user: { select: { id: true, email: true } } },
                    },
                }
            }
        }
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

    return updated;
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

    sendOfferWithdrawn({
        customer: offer.request.customer,
        therapist: offer.therapist,
        offer
    }).catch((err) => {
        logger.error('[OfferService] Offer withdrawn notification failed', { error: err.message });
    });

    return updatedOffer;
}