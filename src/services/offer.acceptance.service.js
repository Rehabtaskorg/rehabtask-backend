import { OFFER_STATUS, BOOKING_STATUS } from "../utils/constants.js";
import { prisma } from "../config/prisma.js";
import { logger } from "../config/logger.js";
import { logAction } from "./audit.service.js";
import { findOrCreateDirectConversation, createSystemMessage } from "./message.service.js";
import { resolveVisitPlan, computeTotalSessions } from "../utils/visitPlan.js";
import { getActiveSubscription } from "./subscription.service.js";
import { APIError } from "../utils/errors.js";
import { THERAPIST_SAFE_SELECT } from "../utils/therapistContactAccess.js";

/**
 * @param {string} offerId
 * @param {string} customerId
 */
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
    const offerVisits = computeTotalSessions(effectivePlan);

    const subscription = await getActiveSubscription(customerId);

    if (subscription.visitLimit < 999999) {
        const inFlightBookings = await prisma.booking.findMany({
            where: { customerId, status: BOOKING_STATUS.PENDING_PAYMENT },
            select: { visitsPerWeek: true, numberOfWeeks: true, visitTypeId: true },
        });
        const inFlightVisits = inFlightBookings.reduce(
            (sum, inFlightBooking) => sum + computeTotalSessions(resolveVisitPlan({ booking: inFlightBooking })),
            0
        );

        const committedVisits = subscription.sessionsUsed + inFlightVisits;
        const remaining = Math.max(subscription.visitLimit - committedVisits, 0);
        const projectedTotal = committedVisits + offerVisits;

        if (projectedTotal > subscription.visitLimit) {
            const err = new APIError(
                `This offer requires ${offerVisits} visit${offerVisits !== 1 ? "s" : ""} but you only have ${remaining} remaining this billing period.`,
                403,
                "VISIT_LIMIT_REACHED"
            );
            err.errors = { offerVisits, remaining, limit: subscription.visitLimit, planType: subscription.planType, inFlightVisits };
            throw err;
        }
    }

    const { updatedOffer, booking } = await prisma.$transaction(async (tx) => {
        const txUpdatedOffer = await tx.offer.update({
            where: { id: offerId },
            data: { status: OFFER_STATUS.ACCEPTED },
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
                    status: BOOKING_STATUS.PENDING_PAYMENT,
                    patientId: offer.request.patientId || null,
                    visitTypeId: effectivePlan.visitTypeId,
                    visitType: effectivePlan.visitType,
                    visitsPerWeek: effectivePlan.visitsPerWeek,
                    numberOfWeeks: effectivePlan.numberOfWeeks,
                },
                include: {
                    therapist: { select: { ...THERAPIST_SAFE_SELECT, phone: true, smsOptIn: true, user: { select: { id: true, email: true } } } },
                    customer: { include: { user: { select: { id: true, email: true } } } },
                    offer: { include: { request: true } },
                    patient: { select: { id: true, fullName: true } },
                },
            });
        } catch (err) {
            if (err.code === "P2002") {
                txBooking = await tx.booking.findFirst({
                    where: { offerId: offer.id },
                    include: {
                        therapist: { select: { ...THERAPIST_SAFE_SELECT, phone: true, smsOptIn: true, user: { select: { id: true, email: true } } } },
                        customer: { include: { user: { select: { id: true, email: true } } } },
                        offer: { include: { request: true } },
                        patient: { select: { id: true, fullName: true } },
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

    return { offer: updatedOffer, booking };
};
