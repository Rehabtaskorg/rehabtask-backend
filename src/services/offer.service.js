import { prisma } from "../config/prisma.js";
import { addHours } from "date-fns";
import { sendNewOfferNotification, sendOfferAccepted } from "./email.service.js";
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
            status: { in: ["pending", "accepted"] },
        },
    });

    if (existingOffer) {
        console.error(`[Offer duplicate check] therapistId=${therapistId} requestId=${requestId} matched existingOfferId=${existingOffer.id}`);
        throw new Error("You have already made an offer for this request");
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
        },
        include: {
            therapist: true,
            request: {
                include: {
                    customer: {
                        include: { user: { select: { id: true, email: true } } }
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

    // Access check: the authenticated user must be the therapist who created this offer
    const therapist = await prisma.therapistProfile.findUnique({
        where: { userId }
    });

    if (!therapist || offer.therapistId !== therapist.id) {
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
        throw new Error("Offer is not longer available");
    }

    if (new Date() > new Date(offer.expiresAt)) {
        throw new Error("Offer has expired");
    }

    // Update offer to accepted
    const updatedOffer = await prisma.offer.update({
        where: { id: offerId },
        data: { status: "accepted" }
    });

    // Reject other offers for this request
    await prisma.offer.updateMany({
        where: {
            requestId: offer.requestId,
            id: { not: offerId },
            status: "pending",
        },
        data: { status: "rejected" },
    });

    // Update request status
    await prisma.therapyRequest.update({
        where: { id: offer.requestId },
        data: { status: "offers_accepted" }
    });

    // Create booking
    const booking = await prisma.booking.create({
        data: {
            offerId,
            customerId,
            therapistId: offer.therapistId,
            scheduledDate: offer.proposedDate,
            rate: offer.rate,
            sessionType: offer.sessionType,
            status: "pending",
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

    // Notify therapist that their offer was accepted (fire-and forget)
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