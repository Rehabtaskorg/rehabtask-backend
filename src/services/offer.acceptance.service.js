import { OFFER_STATUS, BOOKING_STATUS } from "../utils/constants.js";
import { prisma } from "../config/prisma.js";
import { logger } from "../config/logger.js";
import { logAction } from "./audit.service.js";
import { findOrCreateDirectConversation, createSystemMessage } from "./message.service.js";
import { sendOfferAccepted } from "./email.service.js";
import { resolveVisitPlan } from "../utils/visitPlan.js";

export const acceptOffer = async (offerId, customerId) => {
    const offer = await prisma.offer.findUnique({
        where: { id: offerId },
        include: {
            visitTypeRef: true,
            request: { include: { visitTypeRef: true } },
        },
    });

    if (!offer) throw new Error("Offer not found");
    if (offer.request.customerId !== customerId) throw new Error("Unauthorized");
    if (offer.status !== OFFER_STATUS.PENDING) throw new Error("Offer is no longer available");
    if (new Date() > new Date(offer.expiresAt)) throw new Error("Offer has expired");

    const effectivePlan = resolveVisitPlan({ offer, request: offer.request });

    const { updatedOffer, booking } = await prisma.$transaction(async (tx) => {
        const txUpdatedOffer = await tx.offer.update({
            where: { id: offerId },
            data: { status: BOOKING_STATUS.ACCEPTED },
        });

        await tx.offer.updateMany({
            where: { requestId: offer.requestId, id: { not: offerId }, status: BOOKING_STATUS.PENDING },
            data: { status: OFFER_STATUS.REJECTED },
        });

        await tx.therapyRequest.update({
            where: { id: offer.requestId },
            data: { status: "offers_accepted" },
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
                    status: BOOKING_STATUS.ACCEPTED,
                    patientId: offer.request.patientId || null,
                    visitTypeId: effectivePlan.visitTypeId,
                    visitType: effectivePlan.visitType,
                    visitsPerWeek: effectivePlan.visitsPerWeek,
                    numberOfWeeks: effectivePlan.numberOfWeeks,
                },
                include: {
                    therapist: { include: { user: { select: { id: true, email: true } } } },
                    customer: { include: { user: { select: { id: true, email: true } } } },
                    offer: { include: { request: true } },
                },
            });
        } catch (err) {
            if (err.code === "P2002") {
                txBooking = await tx.booking.findFirst({
                    where: { offerId: offer.id },
                    include: {
                        therapist: { include: { user: { select: { id: true, email: true } } } },
                        customer: { include: { user: { select: { id: true, email: true } } } },
                        offer: { include: { request: true } },
                    },
                });
                if (txBooking) return { updatedOffer: txUpdatedOffer, booking: txBooking };
            }
            throw err;
        }

        return { updatedOffer: txUpdatedOffer, booking: txBooking };
    }, { timeout: 15000 });

    logAction({
        actorId: booking.customer.user.id,
        action: "offer.approved_by_customer",
        entityType: "offer",
        entityId: offerId,
        changes: { bookingId: booking.id, therapistId: offer.therapistId, rate: parseFloat(offer.rate) },
    });

    logAction({
        actorId: booking.customer.user.id,
        action: "session.scheduled",
        entityType: "booking",
        entityId: booking.id,
        changes: { offerId, scheduledDate: offer.proposedDate, rate: parseFloat(offer.rate) },
    });

    const acceptCustomerUserId = booking.customer.user.id;
    const acceptTherapistUserId = booking.therapist.user.id;
    const acceptPatientId = booking.offer?.request?.patientId || null;
    findOrCreateDirectConversation(acceptCustomerUserId, acceptTherapistUserId, acceptPatientId)
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

    sendOfferAccepted({ therapist: booking.therapist, customer: booking.customer, booking, offer: booking.offer }).catch((err) => {
        logger.error("[OfferService] Offer accepted notification failed", { error: err.message });
    });

    return { offer: updatedOffer, booking };
};
