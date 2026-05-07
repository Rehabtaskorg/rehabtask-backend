import { prisma, withAdminAccess } from "../config/prisma.js";
import { stripe, stripeConfig } from "../config/stripe.js";
import {
    sendPaymentConfirmation, sendPayoutConfirmation, sendPaymentReleasedToCustomer,
    sendCustomerRefundAvailable, sendCustomerRefundTransferred, sendCustomerRefundReturnedToCard,
} from "./email.service.js";
import { logger } from "../config/logger.js";
import { getCommissionRate } from "./commission.service.js";
import { logAction, logSystemEvent } from "./audit.service.js";
import { findOrCreateDirectConversation, createSystemMessage } from "./message.service.js";
import { resolveVisitPlan, computeTotalSessions } from "../utils/visitPlan.js";

/**
 * Get or create a Stripe customer for a given user.
 * Reusable across payment intent creation and saved payment methods.
 */
const getOrCreateStripeCustomer = async (userId) => {
    const customerProfile = await prisma.customerProfile.findUnique({
        where: { userId },
        include: { user: true },
    });

    if (!customerProfile) {
        throw new Error("Customer profile not found");
    }

    if (customerProfile.stripeCustomerId) {
        return { stripeCustomerId: customerProfile.stripeCustomerId, customerProfile };
    }

    // Check if customer already exists in Stripe by email
    const existingCustomers = await stripe.customers.list({
        email: customerProfile.user.email,
        limit: 1,
    });

    let stripeCustomerId;
    if (existingCustomers.data.length > 0) {
        stripeCustomerId = existingCustomers.data[0].id;
    } else {
        const customer = await stripe.customers.create({
            email: customerProfile.user.email,
            name: customerProfile.fullName,
            metadata: { customerId: customerProfile.id },
        });
        stripeCustomerId = customer.id;
    }

    await prisma.customerProfile.update({
        where: { id: customerProfile.id },
        data: { stripeCustomerId },
    });

    return { stripeCustomerId, customerProfile };
};

/**
 * Create payment intent and escrow funds.
 * If paymentMethodId is provided, charges the saved card immediately.
 */
const createPaymentIntent = async (bookingId, userId, paymentMethodId = null) => {
    const booking = await prisma.booking.findUnique({
        where: { id: bookingId },
        include: {
            customer: { include: { user: true } },
            therapist: { select: { id: true, userId: true, fullName: true, stripeAccountId: true, user: true } },
            visitTypeRef: true,
            offer: {
                include: {
                    visitTypeRef: true,
                    request: { include: { visitTypeRef: true } },
                },
            },
        },
    });

    if (!booking) {
        throw new Error("Booking not found");
    }

    if (booking.customer.userId !== userId) {
        throw new Error("Unauthorized");
    }

    if (!["pending", "accepted"].includes(booking.status)) {
        throw new Error("Booking must be in pending or accepted status");
    }

    // Calculate total amount: rate × total sessions (multi-session support).
    // Visit plan resolves through booking → offer → request, so new bookings
    // use the therapist's accepted override (copy-on-accept), and legacy bookings
    // (where booking.visitsPerWeek is NULL) fall back to the request's values —
    // preserving exact pre-migration behavior.
    const plan = resolveVisitPlan({
        booking,
        offer: booking.offer,
        request: booking.offer?.request,
    });
    const totalSessions = computeTotalSessions(plan);
    const perSessionRate = parseFloat(booking.rate);
    const amount = perSessionRate * totalSessions;

    // Resolve global commission rate
    let feePercent;
    try {
        feePercent = await getCommissionRate();
    } catch (err) {
        logger.error("[PaymentService] Commission rate lookup failed, using env fallback", {
            therapistId: booking.therapist.id,
            error: err.message,
        });
        feePercent = stripeConfig.platformFeePercentage / 100;
    }

    const platformFee = amount * feePercent;
    const therapistPayout = amount - platformFee;

    // Check if payment already exists for this booking
    const existingPayment = await prisma.payment.findUnique({
        where: { bookingId: booking.id }
    });

    let stalePaymentToReuse = null;

    if (existingPayment) {
        // Retrieve the Stripe PaymentIntent to check its current status
        const paymentIntent = await stripe.paymentIntents.retrieve(
            existingPayment.stripePaymentIntentId
        );

        switch (paymentIntent.status) {
            case "succeeded":
                return { status: "succeeded", payment: existingPayment };

            case "processing":
                return { status: "processing", payment: existingPayment };

            case "requires_action": {
                // If a different payment method is being used, cancel and reissue
                const intentPmId = paymentIntent.payment_method?.id ?? paymentIntent.payment_method;
                if (paymentMethodId && intentPmId && intentPmId !== paymentMethodId) {
                    await stripe.paymentIntents.cancel(paymentIntent.id).catch((err) => {
                        logger.warn("[PaymentService] Failed to cancel stale requires_action intent", { intentId: paymentIntent.id, error: err.message });
                    });
                    stalePaymentToReuse = existingPayment;
                    break;
                }
                return { status: "requires_action", clientSecret: paymentIntent.client_secret, payment: existingPayment };
            }

            case "canceled":
            case "requires_payment_method":
                // Intent is expired, failed, or canceled — reuse the record with a new intent
                if (paymentIntent.status !== "canceled") {
                    await stripe.paymentIntents.cancel(paymentIntent.id).catch((err) => {
                        logger.warn("[PaymentService] Failed to cancel stale intent", { intentId: paymentIntent.id, error: err.message });
                    });
                }
                stalePaymentToReuse = existingPayment;
                break;

            default:
                // e.g. requires_confirmation — return clientSecret as normal
                return { clientSecret: paymentIntent.client_secret, payment: existingPayment };
        }
    }

    // Get or create Stripe customer
    const { stripeCustomerId } = await getOrCreateStripeCustomer(userId);

    const intentParams = {
        amount: Math.round(amount * 100),
        currency: "usd",
        customer: stripeCustomerId,
        payment_method_types: ["card"],
        payment_method_options: {
            card: {
                request_three_d_secure: "automatic",
            },
        },
        metadata: {
            bookingId: booking.id,
            customerId: booking.customer.id,
            therapistId: booking.therapist.id,
            platformFee: platformFee.toFixed(2),
            therapistPayout: therapistPayout.toFixed(2),
        },
        description: `Therapy session with ${booking.therapist.fullName}`,
        capture_method: 'automatic',
    };

    // If paying with a saved card, confirm immediately
    if (paymentMethodId) {
        intentParams.payment_method = paymentMethodId;
        intentParams.confirm = true;
        intentParams.return_url = `${process.env.FRONTEND_URL}/customer/bookings/${bookingId}`;
    } else {
        // New card flow: save the card for future use
        intentParams.setup_future_usage = "off_session";
    }

    // Create payment intent
    const paymentIntent = await stripe.paymentIntents.create(intentParams);

    // Create or update payment record
    let payment;
    if (stalePaymentToReuse) {
        // Reuse the existing record — preserves audit trail and avoids unique constraint issues
        payment = await prisma.payment.update({
            where: { id: stalePaymentToReuse.id },
            data: {
                stripePaymentIntentId: paymentIntent.id,
                amount,
                platformFee,
                therapistPayout,
                status: "intent_created",
            },
        });
    } else {
        try {
            payment = await prisma.payment.create({
                data: {
                    bookingId: booking.id,
                    customerId: booking.customer.id,
                    therapistId: booking.therapist.id,
                    stripePaymentIntentId: paymentIntent.id,
                    amount,
                    platformFee,
                    therapistPayout,
                    status: "intent_created"
                },
            });
        } catch (err) {
            // Unique constraint violation on bookingId — a concurrent request already created the payment
            if (err.code === "P2002") {
                // Cancel the Stripe intent we just created since it's now orphaned
                await stripe.paymentIntents.cancel(paymentIntent.id).catch((cancelErr) => {
                    logger.warn("[PaymentService] Failed to cancel orphaned intent after P2002", { intentId: paymentIntent.id, error: cancelErr.message });
                });
                // Return the payment that the other request created
                const existingPayment = await prisma.payment.findUnique({ where: { bookingId: booking.id } });
                if (existingPayment) {
                    const existingIntent = await stripe.paymentIntents.retrieve(existingPayment.stripePaymentIntentId);
                    return { clientSecret: existingIntent.client_secret, payment: existingPayment };
                }
                throw new Error("Payment creation conflict — please retry");
            }
            throw err;
        }
    }

    // Event: payment.intent_created
    logAction({
        actorId: userId,
        action: "payment.intent_created",
        entityType: "payment",
        entityId: payment.id,
        changes: { bookingId, amount, platformFee: platformFee.toFixed(2), therapistPayout: therapistPayout.toFixed(2) },
    });

    // If confirmed immediately and succeeded, the webhook will handle status transitions
    if (paymentIntent.status === "succeeded") {
        return { status: "succeeded", payment };
    }

    // If 3D Secure is required, return clientSecret for frontend to handle
    if (paymentIntent.status === "requires_action") {
        return { status: "requires_action", clientSecret: paymentIntent.client_secret, payment };
    }

    return {
        clientSecret: paymentIntent.client_secret,
        payment
    };
}

/**
 * Handle successful payment (webhook handler)
 */
const handlePaymentSuccess = async (paymentIntentId) => {
    const payment = await prisma.payment.findUnique({
        where: { stripePaymentIntentId: paymentIntentId },
        include: {
            booking: {
                include: {
                    visitTypeRef: true,
                    offer: {
                        include: {
                            visitTypeRef: true,
                            request: { include: { visitTypeRef: true } },
                        },
                    },
                    sessions: true,
                },
            },
        },
    });

    if (!payment) {
        throw new Error("Payment not found");
    }

    // Idempotency: if already processed, return early to prevent duplicate side effects
    if (payment.status === "escrowed") {
        return payment;
    }

    // Calculate total sessions via the shared resolver. Same precedence as
    // createPaymentIntent — booking (authoritative post-acceptance) first,
    // then offer override, then request (legacy fallback).
    const plan = resolveVisitPlan({
        booking: payment.booking,
        offer: payment.booking.offer,
        request: payment.booking.offer?.request,
    });
    const totalSessions = computeTotalSessions(plan);

    const stripeIntent = await stripe.paymentIntents.retrieve(paymentIntentId, { expand: ["charges"] });
    const tds = stripeIntent.charges?.data?.[0]?.payment_method_details?.card?.three_d_secure;
    if (tds?.result === "not_supported" || tds?.result == null) {
        logger.warn("[PaymentService] No 3DS liability shift", { paymentIntentId, bookingId: payment.bookingId, result: tds?.result ?? "none" });
    }

    await prisma.$transaction(async (tx) => {
        await tx.payment.update({
            where: { id: payment.id },
            data: {
                status: "escrowed",
                escrowedAt: new Date(),
                threeDSecureResult: tds?.result ?? null,
                threeDSecureVersion: tds?.version ?? null,
            },
        });

        await tx.booking.update({
            where: { id: payment.bookingId },
            data: { status: "confirmed" },
        });


        // Idempotency: skip session creation if sessions already exist (webhook retry)
        if (payment.booking.sessions?.length === 0) {
            // Build all session rows up front and insert in a single round trip.
            // Sequential tx.session.create() in a loop caused transaction timeouts
            // for large session counts (e.g. 60 sessions × ~90ms = >5s timeout).
            const sessionRows = Array.from({ length: totalSessions }, (_, i) => ({
                bookingId: payment.bookingId,
                sessionNumber: i + 1,
                scheduledDate: i === 0 ? payment.booking.scheduledDate : null,
                status: i === 0 ? "scheduled" : "pending_schedule",
            }));

            await tx.session.createMany({ data: sessionRows });
        }
    }, { timeout: 15000 });

    // Event: payment.escrow_funded (system/webhook triggered)
    logSystemEvent({
        action: "payment.escrow_funded",
        entityType: "payment",
        entityId: payment.id,
        changes: { bookingId: payment.bookingId, amount: parseFloat(payment.amount), stripePaymentIntentId: paymentIntentId },
    });

    // Send payment confirmation email to customer
    const bookingWithDetails = await prisma.booking.findUnique({
        where: { id: payment.bookingId },
        include: {
            customer: { include: { user: { select: { id: true, email: true } } } },
            therapist: { select: { userId: true, fullName: true } },
        },
    });

    if (bookingWithDetails) {
        // System message: payment_confirmed
        const payCustomerUserId = bookingWithDetails.customer.user.id;
        const payTherapistUserId = bookingWithDetails.therapist?.userId;
        if (payCustomerUserId && payTherapistUserId) {
            findOrCreateDirectConversation(payCustomerUserId, payTherapistUserId)
                .then((conversation) =>
                    createSystemMessage({
                        conversationId: conversation.id,
                        actorId: payCustomerUserId,
                        recipientId: payTherapistUserId,
                        content: `Payment received — session confirmed. ($${parseFloat(payment.amount)})`,
                        systemType: "payment_confirmed",
                        bookingId: payment.bookingId,
                    })
                )
                .catch(() => { });
        }

        sendPaymentConfirmation({
            customer: bookingWithDetails.customer,
            booking: bookingWithDetails,
            payment,
        }).catch(() => { });
    }

    return payment;
}

/**
 * Release payment to therapist after session confirmation
 */
const releasePayment = async (sessionId) => {
    const session = await prisma.session.findUnique({
        where: { id: sessionId },
        include: {
            booking: {
                include: {
                    payment: true,
                    therapist: { include: { user: { select: { email: true } } } },
                    customer: { include: { user: { select: { email: true } } } },
                },
            },
        },
    });

    if (!session) {
        throw new Error("Session not found");
    }

    if (session.status !== "confirmed_by_customer") {
        throw new Error("Session must be confirmed by customer before payout");
    }

    const payment = session.booking.payment;

    // Idempotent: if already fully released, return as-is (safe retry after partial failure)
    if (payment && payment.status === "released") {
        return payment;
    }

    if (!payment || !["escrowed", "partially_released"].includes(payment.status)) {
        throw new Error("Payment not in a releasable state");
    }

    // Defense-in-depth: NEVER release payment unless ALL sessions are confirmed.
    const allSessions = await prisma.session.findMany({
        where: { bookingId: session.bookingId },
    });
    const unconfirmedCount = allSessions.filter(s => s.status !== "confirmed_by_customer").length;
    if (unconfirmedCount > 0) {
        throw new Error(`Cannot release payment: ${unconfirmedCount} of ${allSessions.length} session(s) not yet confirmed by customer`);
    }

    const therapist = session.booking.therapist;

    if (!therapist.stripeAccountId) {
        throw new Error("Therapist has not connected Stripe account");
    }

    // Calculate the amount to release — full payout if escrowed, remainder if partially released
    const fullPayout = parseFloat(payment.therapistPayout);
    const alreadyReleased = parseFloat(payment.releasedAmount ?? 0);
    const amountToRelease = payment.status === "partially_released"
        ? parseFloat((fullPayout - alreadyReleased).toFixed(2))
        : fullPayout;

    let transfer;
    try {
        transfer = await stripe.transfers.create({
            amount: Math.round(amountToRelease * 100),
            currency: "usd",
            destination: therapist.stripeAccountId,
            metadata: {
                paymentId: payment.id,
                sessionId: session.id,
                bookingId: session.bookingId,
                isRemainder: alreadyReleased > 0 ? "true" : "false",
            },
            description: alreadyReleased > 0
                ? `Remainder payout for session ${session.id}`
                : `Payout for session ${session.id}`,
        }, {
            idempotencyKey: `release-${payment.id}${alreadyReleased > 0 ? "-remainder" : ""}`,
        });
    } catch (stripeError) {
        logger.error(`Transfer creation failed:`, stripeError.message);
        throw new Error(`Failed to transfer payment: ${stripeError.message}`)
    }

    // Immediately persist the transfer ID so we never lose track of it.
    // This prevents double-pay: if the full status update below fails,
    // processRefund will still see stripeTransferId and block the refund.
    try {
        await prisma.payment.update({
            where: { id: payment.id },
            data: { stripeTransferId: transfer.id },
        });
    } catch (saveTransferIdError) {
        // CRITICAL: Transfer was created in Stripe but we cannot record it.
        // Log everything needed for manual reconciliation.
        logger.error(`CRITICAL: Stripe transfer ${transfer.id} succeeded but failed to save stripeTransferId to payment ${payment.id}. Manual reconciliation required.`, {
            transferId: transfer.id,
            paymentId: payment.id,
            sessionId: session.id,
            bookingId: session.bookingId,
            error: saveTransferIdError.message,
        });
        throw new Error("Transfer succeeded but database update failed. Support has been notified.");
    }

    try {
        const updatedPayment = await prisma.payment.update({
            where: { id: payment.id },
            data: {
                status: "released",
                releasedAt: new Date(),
                releasedAmount: parseFloat(payment.therapistPayout),
            },
        });

        // Event: payment.released_to_therapist
        logSystemEvent({
            action: "payment.released_to_therapist",
            entityType: "payment",
            entityId: payment.id,
            changes: {
                sessionId: session.id,
                bookingId: session.bookingId,
                therapistPayout: parseFloat(payment.therapistPayout),
                stripeTransferId: transfer.id,
            },
        });

        // Event: admin_fee.applied (commission deducted during payout)
        logSystemEvent({
            action: "admin_fee.applied",
            entityType: "payment",
            entityId: payment.id,
            changes: {
                totalAmount: parseFloat(payment.amount),
                platformFee: parseFloat(payment.platformFee),
                therapistPayout: parseFloat(payment.therapistPayout),
            },
        });

        // Send payout confirmation email to therapist
        sendPayoutConfirmation({
            therapist: session.booking.therapist,
            payment: updatedPayment,
            booking: session.booking,
        }).catch(() => { });

        // Notify customer that their payment has been released
        sendPaymentReleasedToCustomer({
            customer: session.booking.customer,
            therapist: session.booking.therapist,
            payment: updatedPayment,
            booking: session.booking,
        }).catch(() => { });

        return updatedPayment;
    } catch (dbError) {
        logger.error(`CRITICAL: Transfer ${transfer.id} succeeded but status update to 'released' failed for payment ${payment.id}. stripeTransferId was saved. Manual status update required.`, {
            transferId: transfer.id,
            paymentId: payment.id,
            error: dbError.message,
        });
        throw new Error("Transfer succeeded but database update failed. Support has been notified.");
    }
}

/**
 * Release a per-session payout for a single confirmed session.
 *
 * Called by confirmSessionByCustomer after each session is confirmed.
 * Creates a Stripe transfer for the pro-rated therapist share, records a
 * SessionPayout audit row, and increments payment.releasedAmount.
 *
 * Rounding strategy: sessions 1..N-1 get floor(perSessionPayout). The
 * last session (isLast=true) gets payment.therapistPayout - alreadyReleased
 * so the total is exact to the penny.
 *
 * @param {object} opts
 * @param {object} opts.session - Session row (must be confirmed_by_customer)
 * @param {object} opts.payment - Payment row for the booking
 * @param {object} opts.booking - Booking row with therapist relation
 * @param {boolean} opts.isLast - Whether this is the final payout for the booking
 * @returns {Promise<object>} The created SessionPayout record
 */
const releaseSessionPayout = async ({ session, payment, booking, isLast }) => {
    // Guard: already paid (idempotent)
    const existingPayout = await prisma.sessionPayout.findUnique({
        where: { sessionId: session.id },
    });
    if (existingPayout) {
        logger.info("[PaymentService] Session payout already exists, skipping", {
            sessionId: session.id,
            payoutId: existingPayout.id,
        });
        return existingPayout;
    }

    const therapist = booking.therapist;
    if (!therapist.stripeAccountId) {
        throw new Error("Therapist has not connected Stripe account");
    }

    if (!["escrowed", "partially_released"].includes(payment.status)) {
        throw new Error(`Payment not in a releasable state (current: ${payment.status})`);
    }

    const alreadyReleased = parseFloat(payment.releasedAmount ?? 0);
    const totalTherapistPayout = parseFloat(payment.therapistPayout);
    const totalAmount = parseFloat(payment.amount);
    const totalFee = parseFloat(payment.platformFee);
    const perSessionRate = parseFloat(booking.rate);

    // Get sum of previous session payouts for precise remainder calculation
    const previousPayouts = await prisma.sessionPayout.findMany({
        where: { paymentId: payment.id },
    });
    const previousPayoutSum = previousPayouts.reduce((sum, p) => sum + parseFloat(p.therapistPayout), 0);
    const previousFeeSum = previousPayouts.reduce((sum, p) => sum + parseFloat(p.platformFee), 0);
    const previousAmountSum = previousPayouts.reduce((sum, p) => sum + parseFloat(p.amount), 0);

    let perSessionTherapistPayout;
    let perSessionFee;
    let perSessionAmount;

    if (isLast) {
        // Last payout gets the exact remainder — no rounding error
        perSessionTherapistPayout = parseFloat((totalTherapistPayout - previousPayoutSum).toFixed(2));
        perSessionFee = parseFloat((totalFee - previousFeeSum).toFixed(2));
        perSessionAmount = parseFloat((totalAmount - previousAmountSum).toFixed(2));
    } else {
        // Standard per-session calculation with floor for predictability
        perSessionAmount = perSessionRate;
        perSessionFee = Math.floor(perSessionRate * (totalFee / totalAmount) * 100) / 100;
        perSessionTherapistPayout = parseFloat((perSessionAmount - perSessionFee).toFixed(2));
    }

    // Safety: never transfer a negative or zero amount
    if (perSessionTherapistPayout <= 0) {
        logger.warn("[PaymentService] Per-session payout is zero or negative, skipping transfer", {
            sessionId: session.id,
            perSessionTherapistPayout,
            isLast,
        });
        return null;
    }

    // Create Stripe transfer
    let transfer;
    try {
        transfer = await stripe.transfers.create({
            amount: Math.round(perSessionTherapistPayout * 100),
            currency: "usd",
            destination: therapist.stripeAccountId,
            metadata: {
                paymentId: payment.id,
                sessionId: session.id,
                bookingId: booking.id,
                sessionNumber: session.sessionNumber,
                isPerSession: "true",
            },
            description: `Session ${session.sessionNumber} payout for booking ${booking.id}`,
        }, {
            idempotencyKey: `session-payout-${session.id}`,
        });
    } catch (stripeError) {
        logger.error("[PaymentService] Per-session transfer failed", {
            sessionId: session.id,
            error: stripeError.message,
        });
        throw new Error(`Failed to transfer session payout: ${stripeError.message}`);
    }

    // Create the SessionPayout record + update payment.releasedAmount in a transaction
    const newReleasedAmount = parseFloat((alreadyReleased + perSessionTherapistPayout).toFixed(2));
    const allSessionsPaid = isLast || newReleasedAmount >= totalTherapistPayout - 0.01;

    const sessionPayout = await prisma.$transaction(async (tx) => {
        const payout = await tx.sessionPayout.create({
            data: {
                sessionId: session.id,
                paymentId: payment.id,
                stripeTransferId: transfer.id,
                amount: perSessionAmount,
                platformFee: perSessionFee,
                therapistPayout: perSessionTherapistPayout,
            },
        });

        await tx.payment.update({
            where: { id: payment.id },
            data: {
                releasedAmount: newReleasedAmount,
                status: allSessionsPaid ? "released" : "partially_released",
                ...(allSessionsPaid && { releasedAt: new Date() }),
            },
        });

        return payout;
    });

    // Audit event
    logSystemEvent({
        action: "payment.released_to_therapist",
        entityType: "session_payout",
        entityId: sessionPayout.id,
        changes: {
            sessionId: session.id,
            bookingId: booking.id,
            therapistPayout: perSessionTherapistPayout,
            stripeTransferId: transfer.id,
            sessionNumber: session.sessionNumber,
            isLast,
        },
    });

    logger.info("[PaymentService] Per-session payout released", {
        sessionId: session.id,
        sessionNumber: session.sessionNumber,
        bookingId: booking.id,
        amount: perSessionTherapistPayout,
        transferId: transfer.id,
        isLast,
        newReleasedAmount,
    });

    return sessionPayout;
};

/**
 * Release a partial payout for a single session — used by the Attempted Visit flow.
 *
 * Unlike releaseSessionPayout which pays the full per-session rate, this pays an
 * arbitrary amount (the therapist's attempted-visit rate) and applies the same
 * commission ratio as the original escrow. The remainder of the session's escrow
 * is refunded to the customer via createPerSessionRefund in the calling flow.
 *
 * Invariants:
 *   - SessionPayout.sessionId is @unique — each session can have at most one payout
 *     row (attempted OR confirmed, never both).
 *   - Stripe idempotency key is session-scoped + suffix-discriminated so a session
 *     that somehow went through both paths (shouldn't happen — status guard) would
 *     not reuse a cached response.
 *   - payment.status transitions: escrowed -> partially_released. Never flips to
 *     released here (the caller knows whether this was the last deliverable session
 *     and handles the booking.finalized transition separately).
 *
 * @param {object} opts
 * @param {object} opts.session - Session row (must be 'scheduled', about to flip to 'attempted')
 * @param {object} opts.payment - Payment row { id, status, amount, platformFee, therapistPayout, releasedAmount }
 * @param {object} opts.booking - Booking row with therapist relation
 * @param {number} opts.amount - Gross amount to release (pre-commission) e.g. attemptedVisitRate
 * @returns {Promise<object|null>} The SessionPayout record, or null if amount <= 0
 */
const releasePartialSessionPayout = async ({ session, payment, booking, amount }) => {
    // Idempotency guard: session can only have one payout row ever.
    const existingPayout = await prisma.sessionPayout.findUnique({
        where: { sessionId: session.id },
    });
    if (existingPayout) {
        logger.info("[PaymentService] Partial session payout already exists, skipping", {
            sessionId: session.id,
            payoutId: existingPayout.id,
        });
        return existingPayout;
    }

    const therapist = booking.therapist;
    if (!therapist.stripeAccountId) {
        throw new Error("Therapist has not connected Stripe account");
    }

    if (!["escrowed", "partially_released"].includes(payment.status)) {
        throw new Error(`Payment not in a releasable state (current: ${payment.status})`);
    }

    // Precision-safe rounding
    const grossAmount = Math.round(Number(amount) * 100) / 100;

    if (!Number.isFinite(grossAmount) || grossAmount <= 0) {
        logger.info("[PaymentService] Partial payout amount is zero or invalid — skipping Stripe transfer", {
            sessionId: session.id,
            grossAmount,
        });
        return null;
    }

    // Apply the same commission ratio used when the escrow was originally funded.
    // This keeps commission accounting uniform across confirmed and attempted sessions.
    const totalAmount = parseFloat(payment.amount);
    const totalFee = parseFloat(payment.platformFee);
    const feeRatio = totalAmount > 0 ? (totalFee / totalAmount) : 0;
    const partialFee = Math.floor(grossAmount * feeRatio * 100) / 100;
    const partialTherapistPayout = parseFloat((grossAmount - partialFee).toFixed(2));

    if (partialTherapistPayout <= 0) {
        logger.warn("[PaymentService] Partial therapist payout <= 0 after commission, skipping transfer", {
            sessionId: session.id,
            grossAmount,
            partialFee,
        });
        return null;
    }

    const alreadyReleased = parseFloat(payment.releasedAmount ?? 0);
    const totalTherapistPayout = parseFloat(payment.therapistPayout);

    // Guard against over-release caused by any prior partials + this one
    if (alreadyReleased + partialTherapistPayout > totalTherapistPayout + 0.01) {
        throw new Error(
            `Partial payout would exceed total therapist payout ` +
            `(alreadyReleased=${alreadyReleased}, partial=${partialTherapistPayout}, total=${totalTherapistPayout})`
        );
    }

    // Stripe transfer — isPerSession metadata flag keeps the webhook recovery
    // handler from race-flipping the payment to released (see webhook.controller.js).
    let transfer;
    try {
        transfer = await stripe.transfers.create({
            amount: Math.round(partialTherapistPayout * 100),
            currency: "usd",
            destination: therapist.stripeAccountId,
            metadata: {
                paymentId: payment.id,
                sessionId: session.id,
                bookingId: booking.id,
                sessionNumber: String(session.sessionNumber ?? ""),
                isPerSession: "true",
                isAttempted: "true",
                grossAmount: String(grossAmount),
            },
            description: `Attempted-visit payout for session ${session.sessionNumber ?? ""} (booking ${booking.id})`,
        }, {
            idempotencyKey: `session-attempted-payout-${session.id}`,
        });
    } catch (stripeError) {
        logger.error("[PaymentService] Partial session transfer failed", {
            sessionId: session.id,
            error: stripeError.message,
        });
        throw new Error(`Failed to transfer attempted-visit payout: ${stripeError.message}`);
    }

    const newReleasedAmount = parseFloat((alreadyReleased + partialTherapistPayout).toFixed(2));
    // An attempted visit is a partial per-session release. We DO NOT flip the
    // payment to "released" here — the calling service (markSessionAttempted)
    // decides whether the whole booking is done and handles that transition.
    const nextStatus = "partially_released";

    const sessionPayout = await prisma.$transaction(async (tx) => {
        const payout = await tx.sessionPayout.create({
            data: {
                sessionId: session.id,
                paymentId: payment.id,
                stripeTransferId: transfer.id,
                amount: grossAmount,
                platformFee: partialFee,
                therapistPayout: partialTherapistPayout,
            },
        });

        await tx.payment.update({
            where: { id: payment.id },
            data: {
                releasedAmount: newReleasedAmount,
                status: nextStatus,
            },
        });

        return payout;
    });

    logSystemEvent({
        action: "payment.released_to_therapist",
        entityType: "session_payout",
        entityId: sessionPayout.id,
        changes: {
            sessionId: session.id,
            bookingId: booking.id,
            grossAmount,
            therapistPayout: partialTherapistPayout,
            platformFee: partialFee,
            stripeTransferId: transfer.id,
            sessionNumber: session.sessionNumber,
            isAttempted: true,
        },
    });

    logger.info("[PaymentService] Partial session payout released (attempted visit)", {
        sessionId: session.id,
        bookingId: booking.id,
        grossAmount,
        therapistPayout: partialTherapistPayout,
        transferId: transfer.id,
        newReleasedAmount,
    });

    return sessionPayout;
};

/**
 * Finalize an incomplete booking — pay out all confirmed-but-unpaid sessions
 * and refund the customer for undelivered sessions.
 *
 * Therapist-only action. Used when a care series is abandoned (patient stops
 * showing up, care plan changes, etc.).
 *
 * @param {string} bookingId
 * @param {string} therapistId - for authorization
 * @returns {Promise<object>} { booking, payment, paidSessions, refundedSessions, refundAmount }
 */
const finalizeBooking = async (bookingId, therapistId) => {
    const booking = await prisma.booking.findUnique({
        where: { id: bookingId },
        include: {
            therapist: { include: { user: { select: { id: true, email: true } } } },
            customer: { include: { user: { select: { id: true, email: true } } } },
            payment: { include: { sessionPayouts: true } },
            sessions: { orderBy: { sessionNumber: "asc" } },
        },
    });

    if (!booking) throw new Error("Booking not found");
    if (booking.therapistId !== therapistId) throw new Error("Unauthorized");

    if (!["confirmed", "in_progress"].includes(booking.status)) {
        throw new Error(`Booking cannot be finalized in '${booking.status}' status`);
    }

    const payment = booking.payment;
    if (!payment || !["escrowed", "partially_released"].includes(payment.status)) {
        throw new Error("Payment not in a releasable state");
    }

    const confirmedSessions = booking.sessions.filter(s => s.status === "confirmed_by_customer");
    // Exclude sessions already fully resolved per-session:
    //   - missed:   refunded in full to customer via markSessionMissed
    //   - attempted: partial payout to therapist + remainder refunded to customer
    //                via markSessionAttempted (both money flows already completed)
    //   - cancelled: never refundable through finalize
    const undeliveredSessions = booking.sessions.filter(s =>
        s.status !== "confirmed_by_customer" &&
        s.status !== "cancelled" &&
        s.status !== "missed" &&
        s.status !== "attempted"
    );

    if (confirmedSessions.length === 0) {
        throw new Error("No confirmed sessions to finalize. Use cancellation instead.");
    }
    if (undeliveredSessions.length === 0) {
        throw new Error("All sessions are confirmed. This booking should be completed, not finalized.");
    }

    // Find confirmed sessions that haven't been paid yet
    const paidSessionIds = new Set(booking.payment.sessionPayouts.map(p => p.sessionId));
    const unpaidConfirmedSessions = confirmedSessions.filter(s => !paidSessionIds.has(s.id));

    // Pay out each unpaid confirmed session
    const newPayouts = [];
    for (let i = 0; i < unpaidConfirmedSessions.length; i++) {
        const session = unpaidConfirmedSessions[i];
        const isLastDeliveredPayout = i === unpaidConfirmedSessions.length - 1;

        // Refresh payment to get current releasedAmount after each payout.
        // Note: `booking` is NOT refreshed — only booking.rate and
        // booking.therapist.stripeAccountId are read by releaseSessionPayout,
        // neither of which changes during this loop.
        const currentPayment = await prisma.payment.findUnique({ where: { id: payment.id } });

        // For finalize, "isLast" means it's the last of the DELIVERED sessions.
        // We don't want the last-session-gets-remainder logic to use the FULL
        // therapistPayout (which includes undelivered sessions). Instead we cap
        // the total released to deliveredSessions × perSessionRate × (1 - fee%).
        const payout = await releaseSessionPayout({
            session,
            payment: currentPayment,
            booking,
            isLast: false, // never use remainder logic during finalize — refund handles the rest
        });
        if (payout) newPayouts.push(payout);
    }

    // Cancel all undelivered sessions
    await prisma.session.updateMany({
        where: {
            id: { in: undeliveredSessions.map(s => s.id) },
        },
        data: {
            status: "cancelled",
            cancellationReason: "Series finalized by therapist",
        },
    });

    // Calculate refund amount for undelivered sessions
    const perSessionRate = parseFloat(booking.rate);
    const refundAmount = parseFloat((undeliveredSessions.length * perSessionRate).toFixed(2));

    // Refresh payment state after all payouts
    const refreshedPayment = await prisma.payment.findUnique({ where: { id: payment.id } });
    const totalReleased = parseFloat(refreshedPayment.releasedAmount ?? 0);

    // ── Refund logic: transfer to Connect or create pending record ──
    let customerRefund = null;
    let stripeTransfer = null;

    if (refundAmount > 0) {
        const customer = booking.customer;

        if (customer.stripeAccountId && customer.stripeOnboardingComplete) {
            // Customer has a verified Connect account → transfer immediately
            try {
                stripeTransfer = await stripe.transfers.create({
                    amount: Math.round(refundAmount * 100),
                    currency: "usd",
                    destination: customer.stripeAccountId,
                    metadata: {
                        type: "customer_refund",
                        bookingId: booking.id,
                        paymentId: payment.id,
                        reason: "series_finalized",
                        undeliveredSessions: undeliveredSessions.length,
                    },
                }, {
                    idempotencyKey: `finalize-refund-${booking.id}`,
                });

                customerRefund = await prisma.customerRefund.create({
                    data: {
                        customerId: customer.id,
                        paymentId: payment.id,
                        bookingId: booking.id,
                        amount: refundAmount,
                        status: "transferred",
                        stripeTransferId: stripeTransfer.id,
                        transferredAt: new Date(),
                        reason: "series_finalized",
                    },
                });

                logger.info("[PaymentService] Refund transferred to customer Connect account", {
                    bookingId: booking.id,
                    refundAmount,
                    transferId: stripeTransfer.id,
                });
            } catch (stripeError) {
                logger.error("[PaymentService] CRITICAL: Refund transfer failed — creating pending record instead", {
                    bookingId: booking.id,
                    refundAmount,
                    error: stripeError.message,
                });
                // Fall through to pending_connect path below
            }
        }

        if (!customerRefund) {
            // No Connect account, or transfer failed → create pending refund record
            // The 30-day cron will fall back to card refund if customer never sets up Connect
            customerRefund = await prisma.customerRefund.create({
                data: {
                    customerId: customer.id,
                    paymentId: payment.id,
                    bookingId: booking.id,
                    amount: refundAmount,
                    status: "pending_connect",
                    reason: "series_finalized",
                },
            });

            logger.info("[PaymentService] Pending refund created (awaiting customer Connect setup)", {
                bookingId: booking.id,
                refundAmount,
                expiresAt: customerRefund.expiresAt,
                customerHasConnect: !!customer.stripeAccountId,
            });
        }
    }

    // Update payment and booking status
    const updatedPayment = await prisma.payment.update({
        where: { id: payment.id },
        data: {
            status: "released",
            releasedAt: new Date(),
            refundedAmount: refundAmount > 0 ? refundAmount : undefined,
            refundedAt: refundAmount > 0 ? new Date() : undefined,
        },
    });

    await prisma.booking.update({
        where: { id: booking.id },
        data: { status: "finalized" },
    });

    // Audit events
    logSystemEvent({
        action: "booking.finalized",
        entityType: "booking",
        entityId: booking.id,
        changes: {
            confirmedSessions: confirmedSessions.length,
            undeliveredSessions: undeliveredSessions.length,
            totalReleased,
            refundAmount,
            refundMethod: stripeTransfer ? "connect_transfer" : "pending_connect",
            customerRefundId: customerRefund?.id,
            stripeTransferId: stripeTransfer?.id,
        },
    });

    logSystemEvent({
        action: "admin_fee.applied",
        entityType: "payment",
        entityId: payment.id,
        changes: {
            totalAmount: parseFloat(payment.amount),
            platformFee: parseFloat(payment.platformFee),
            therapistPayout: totalReleased,
            refundedAmount: refundAmount,
        },
    });

    // Notify therapist
    sendPayoutConfirmation({
        therapist: booking.therapist,
        payment: updatedPayment,
        booking,
    }).catch(() => { });

    // Notify customer about the refund
    if (refundAmount > 0) {
        if (customerRefund?.status === "transferred") {
            sendCustomerRefundTransferred({
                customer: booking.customer,
                refundAmount,
            }).catch(() => { });
        } else {
            sendCustomerRefundAvailable({
                customer: booking.customer,
                therapist: booking.therapist,
                refundAmount,
                bookingId: booking.id,
            }).catch(() => { });
        }
    }

    logger.info("[PaymentService] Booking finalized", {
        bookingId: booking.id,
        confirmedSessions: confirmedSessions.length,
        undeliveredSessions: undeliveredSessions.length,
        totalReleased,
        refundAmount,
        refundMethod: stripeTransfer ? "connect_transfer" : (refundAmount > 0 ? "pending_connect" : "none"),
    });

    return {
        booking: { ...booking, status: "finalized" },
        payment: updatedPayment,
        paidSessions: confirmedSessions.length,
        refundedSessions: undeliveredSessions.length,
        refundAmount,
        customerRefund,
    };
};

/**
 * Process refund
 */
const processRefund = async (bookingId, userId, reason) => {
    const booking = await prisma.booking.findUnique({
        where: { id: bookingId },
        include: {
            payment: true,
            sessions: { orderBy: { sessionNumber: "asc" } },
            customer: { select: { userId: true } },
        },
    });

    if (!booking || !booking.payment) {
        throw new Error("Booking or payment not found");
    }

    // Ownership check: only the customer who owns this booking can request a refund
    if (booking.customer.userId !== userId) {
        throw new Error("Unauthorized: you can only refund your own bookings");
    }

    const payment = booking.payment;

    if (!["escrowed", "intent_created"].includes(payment.status)) {
        throw new Error("Payment cannot be refunded");
    }

    // Defense-in-depth: block refund if funds were already transferred to therapist.
    // Without this, customer gets full refund while therapist keeps the transfer — net loss.
    if (payment.stripeTransferId) {
        throw new Error(
            "Payment cannot be refunded because funds have already been transferred to the therapist. Please contact support."
        );
    }

    let refund = null;

    if (payment.status === "intent_created") {
        // Payment was never charged — cancel the PaymentIntent instead of refunding
        try {
            await stripe.paymentIntents.cancel(payment.stripePaymentIntentId, {
                cancellation_reason: "requested_by_customer",
            });
        } catch (cancelErr) {
            logger.warn("[PaymentService] Failed to cancel intent during refund", {
                intentId: payment.stripePaymentIntentId,
                error: cancelErr.message,
            });
        }
    } else {
        // Payment was charged (escrowed) — issue a Stripe refund
        refund = await stripe.refunds.create({
            payment_intent: payment.stripePaymentIntentId,
            reason: "requested_by_customer",
            metadata: {
                bookingId: booking.id,
                refundReason: reason,
            },
        });
    }

    await prisma.$transaction(async (tx) => {
        await tx.payment.update({
            where: { id: payment.id },
            data: payment.status === "intent_created"
                ? { status: "failed" }
                : { status: "refunded", refundedAt: new Date() },
        });

        await tx.booking.update({
            where: { id: bookingId },
            data: { status: "cancelled" },
        });

        // Cancel all sessions in one batch — updateMany is a single DB round trip
        // regardless of session count, avoiding transaction timeouts on large bookings.
        if (booking.sessions?.length > 0) {
            await tx.session.updateMany({
                where: { bookingId },
                data: {
                    status: "cancelled",
                    cancellationReason: reason,
                },
            });
        }
    }, { timeout: 15000 });

    // Event: payment.refunded
    logAction({
        actorId: userId,
        action: "payment.refunded",
        entityType: "payment",
        entityId: payment.id,
        changes: { bookingId, amount: parseFloat(payment.amount), reason, previousStatus: payment.status },
    });

    return { refund, paymentId: payment.id, amount: parseFloat(payment.amount) };
}

/**
 * Get customer payment history
 */
const getCustomerPaymentHistory = async (customerId) => {
    return prisma.payment.findMany({
        where: { customerId },
        include: {
            booking: {
                include: {
                    therapist: true,
                    offer: {
                        include: {
                            request: true,
                        },
                    },
                    sessions: { orderBy: { sessionNumber: "asc" } },
                },
            },
            customerRefunds: {
                select: {
                    id: true,
                    amount: true,
                    status: true,
                    transferredAt: true,
                    fallbackRefundAt: true,
                    expiresAt: true,
                    createdAt: true,
                },
                orderBy: { createdAt: "desc" },
            },
        },
        orderBy: { createdAt: "desc" },
    });
};

/**
 * Get therapist earnings/payout history
 */
const getTherapistPayoutHistory = async (therapistId) => {
    const [payments, therapist] = await Promise.all([
        prisma.payment.findMany({
            where: {
                therapistId,
                status: { in: ["released", "partially_released", "escrowed"] },
            },
            include: {
                sessionPayouts: { orderBy: { createdAt: "desc" } },
                booking: {
                    include: {
                        customer: true,
                        sessions: { select: { id: true, status: true } },
                        offer: {
                            include: {
                                request: true,
                            },
                        },
                    },
                },
            },
            orderBy: { createdAt: "desc" },
        }),
        prisma.therapistProfile.findUnique({
            where: { id: therapistId },
            select: { planTier: true },
        }),
    ]);

    const releasedPayments = payments.filter((p) => ["released", "partially_released"].includes(p.status));
    // Exclude escrowed payments whose booking is finalized or cancelled — those
    // will never pay out (all sessions missed/cancelled, customer refunded).
    const escrowedPayments = payments.filter((p) =>
        p.status === "escrowed" &&
        !["finalized", "cancelled"].includes(p.booking?.status)
    );

    // Helper: adjust a payment's max payout for missed/cancelled sessions.
    // Each missed/cancelled session was per-session refunded to the customer —
    // the therapist can never earn that portion, so it should not be counted
    // as pending.
    const getAdjustedPayout = (p) => {
        const sessions = p.booking?.sessions || [];
        const total = sessions.length;
        if (total <= 1) return parseFloat(p.therapistPayout);
        const missedOrCancelled = sessions.filter((s) => s.status === "missed" || s.status === "cancelled").length;
        if (missedOrCancelled === 0) return parseFloat(p.therapistPayout);
        const deliverable = Math.max(0, total - missedOrCancelled);
        return parseFloat(((parseFloat(p.therapistPayout) / total) * deliverable).toFixed(2));
    };

    const totalEarnings = releasedPayments
        .reduce((sum, p) => sum + parseFloat(p.releasedAmount ?? p.therapistPayout), 0);

    const pendingEarnings = escrowedPayments
        .reduce((sum, p) => sum + getAdjustedPayout(p), 0)
        + payments
            .filter((p) => p.status === "partially_released")
            .reduce((sum, p) => sum + Math.max(0, getAdjustedPayout(p) - parseFloat(p.releasedAmount ?? 0)), 0);

    const pendingSessionCount = [...escrowedPayments, ...payments.filter((p) => p.status === "partially_released")]
        .reduce((count, p) => {
            const sessions = p.booking?.sessions || [];
            return count + sessions.filter((s) => !["confirmed_by_customer", "cancelled", "missed", "attempted"].includes(s.status)).length;
        }, 0);

    // Earnings grouped by month (last 6 months) — aggregated in JS to avoid raw SQL
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    sixMonthsAgo.setDate(1);
    sixMonthsAgo.setHours(0, 0, 0, 0);

    const earningsByMonthMap = {};
    for (const p of releasedPayments) {
        const d = new Date(p.releasedAt || p.createdAt);
        if (d < sixMonthsAgo) continue;
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
        if (!earningsByMonthMap[key]) earningsByMonthMap[key] = { month: key, earnings: 0, sessions: 0 };
        earningsByMonthMap[key].earnings += parseFloat(p.releasedAmount ?? p.therapistPayout);
        earningsByMonthMap[key].sessions += 1;
    }
    const earningsByMonth = Object.values(earningsByMonthMap).sort((a, b) => a.month.localeCompare(b.month));

    // Commission info for this therapist's tier
    // Use the global commission rate — same source as getCommissionRate() which
    // is used during actual payment computation. Tier-specific rates exist in the
    // DB but are not applied until subscription billing is implemented.
    const globalRate = await prisma.commissionConfig.findFirst({
        where: { tier: null, effectiveFrom: { lte: new Date() } },
        orderBy: { effectiveFrom: "desc" },
    });
    const commissionInfo = {
        planTier: therapist?.planTier ?? "basic",
        commissionRate: globalRate ? parseFloat(globalRate.rate) : 0.1,
    };

    // Period stats: this month vs last month
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);

    const thisMonthPayments = releasedPayments.filter((p) => new Date(p.releasedAt || p.createdAt) >= startOfMonth);
    const lastMonthPayments = releasedPayments.filter((p) => {
        const d = new Date(p.releasedAt || p.createdAt);
        return d >= startOfLastMonth && d < startOfMonth;
    });

    const periodStats = {
        thisMonth: {
            earnings: thisMonthPayments.reduce((s, p) => s + parseFloat(p.releasedAmount ?? p.therapistPayout), 0),
            sessions: thisMonthPayments.length,
        },
        lastMonth: {
            earnings: lastMonthPayments.reduce((s, p) => s + parseFloat(p.releasedAmount ?? p.therapistPayout), 0),
            sessions: lastMonthPayments.length,
        },
    };

    return {
        payments,
        totalEarnings,
        pendingEarnings,
        pendingSessionCount,
        earningsByMonth,
        commissionInfo,
        periodStats,
    };
}

/**
 * Create or retrieve a Stripe Custom Connect account for a therapist.
 *
 * Custom accounts (not Express) are required for the embedded component
 * onboarding + white-label earnings dashboard. Key controller flags:
 *   - requirement_collection: "application"  → platform drives KYC via
 *     embedded ConnectAccountOnboarding; no Stripe-hosted dashboard needed
 *   - stripe_dashboard: { type: "none" }     → disables external Stripe
 *     Express Dashboard entirely (white-label requirement)
 *   - losses/fees on "application"           → platform bears liability and
 *     controls fee structure (standard for Connect platforms)
 *
 * Idempotent: if the therapist already has a stripeAccountId this function
 * skips creation and returns the existing ID immediately.
 */
const createOrGetConnectAccount = async (therapistId, userId) => {
    const therapist = await prisma.therapistProfile.findUnique({
        where: { id: therapistId },
        include: { user: true },
    });

    if (!therapist) {
        throw new Error("Therapist not found");
    }

    if (therapist.userId !== userId) {
        throw new Error("Unauthorized");
    }

    // Already has an account — nothing to create
    if (therapist.stripeAccountId) {
        return { accountId: therapist.stripeAccountId };
    }

    const account = await stripe.accounts.create({
        country: "US",
        email: therapist.user.email,
        capabilities: {
            transfers: { requested: true },
            card_payments: { requested: true },
        },
        controller: {
            // Platform collects all requirements via the embedded onboarding component.
            // This also unlocks disable_stripe_user_authentication on Account Sessions,
            // meaning therapists don't need a separate Stripe login to use components.
            requirement_collection: "application",
            // Fully white-label: no Stripe-hosted Express Dashboard
            stripe_dashboard: { type: "none" },
            // Platform absorbs dispute losses and pays Stripe fees
            losses: { payments: "application" },
            fees: { payer: "application" },
        },
        metadata: {
            therapistId: therapist.id,
            userId: therapist.userId,
        },
    });

    await withAdminAccess(async (db) => {
        await db.therapistProfile.update({
            where: { id: therapistId },
            data: { stripeAccountId: account.id },
        });
    });

    return { accountId: account.id };
};

/**
 * Create a short-lived Stripe Account Session for embedded components.
 *
 * The returned client_secret is consumed directly by the frontend
 * StripeConnectProvider's fetchClientSecret callback. It is single-use
 * and expires after ~60 minutes. Never cache it — Stripe calls
 * fetchClientSecret automatically when a session expires.
 *
 * Components enabled:
 *   - account_onboarding  → embedded KYC form (Step 5 of onboarding)
 *   - balances            → balance display + instant payout ("Cash Out")
 *                           + bank account management
 *   - payments            → transaction history + dispute management
 *   - payouts_list        → standalone payout history list
 *
 * Legacy account compatibility:
 *   `disable_stripe_user_authentication` is only valid for accounts where
 *   the platform owns requirements collection (controller-based accounts
 *   created with `requirement_collection: "application"`). Express and
 *   Standard accounts created before our migration cannot use this flag —
 *   Stripe rejects the request with a 400. We retrieve the account before
 *   creating the session and only set the flag when the account supports
 *   it. Pre-migration Express therapists fall back to the default Stripe
 *   auth flow inside the embedded components, while new controller-based
 *   therapists keep the fully white-label experience.
 */
const createAccountSession = async (therapistId, userId) => {
    const therapist = await prisma.therapistProfile.findUnique({
        where: { id: therapistId },
    });

    if (!therapist) {
        throw new Error("Therapist not found");
    }

    if (therapist.userId !== userId) {
        throw new Error("Unauthorized");
    }

    if (!therapist.stripeAccountId) {
        throw new Error("No Stripe account connected. Please complete account setup first.");
    }

    // Retrieve the account so we can branch on its controller config.
    // Controller-based accounts have controller.requirement_collection === "application";
    // legacy Express/Standard accounts either lack the controller block entirely
    // or have requirement_collection === "stripe".
    const account = await stripe.accounts.retrieve(therapist.stripeAccountId);
    const platformOwnsRequirements =
        account?.controller?.requirement_collection === "application";

    // Feature flags per Stripe AccountSessions API spec:
    //   - account_onboarding: disable_stripe_user_authentication, external_account_collection
    //   - balances: disable_stripe_user_authentication, edit_payout_schedule,
    //     external_account_collection, instant_payouts, standard_payouts
    //   - payments: capture_payments, dispute_management, refund_management
    //     (NO disable_stripe_user_authentication)
    //   - payouts_list: no features
    const session = await stripe.accountSessions.create({
        account: therapist.stripeAccountId,
        components: {
            account_onboarding: {
                enabled: true,
                features: {
                    // Only valid for controller-based accounts (see comment block above)
                    ...(platformOwnsRequirements && {
                        disable_stripe_user_authentication: true,
                    }),
                    external_account_collection: true,
                },
            },
            balances: {
                enabled: true,
                features: {
                    instant_payouts: false,
                    // Standard scheduled payouts
                    standard_payouts: true,
                    // Let therapists manage their own payout schedule
                    edit_payout_schedule: true,
                    // Bank account add/remove lives inside this component (no separate flow needed)
                    external_account_collection: true,
                    // Only valid for controller-based accounts (see comment block above)
                    ...(platformOwnsRequirements && {
                        disable_stripe_user_authentication: true,
                    }),
                },
            },
            payments: {
                enabled: true,
                features: {
                    // Therapists cannot issue refunds — that's a platform/admin action
                    refund_management: false,
                    // Therapists should be able to respond to disputes
                    dispute_management: true,
                    // Payments are captured server-side; therapists have no capture UI
                    capture_payments: false,
                    // NOTE: payments component does NOT support disable_stripe_user_authentication
                },
            },
            payouts_list: {
                enabled: true,
            },
        },
    });

    return { clientSecret: session.client_secret };
};

/**
 * Check Stripe Connect account status.
 *
 * Returns a rich requirements summary so the frontend can surface the right
 * warning at the right time — proactive (future), warning (currently_due),
 * or critical (past_due / restricted) — rather than a single generic
 * "under review" state for all non-active accounts.
 */
const getConnectAccountStatus = async (therapistId) => {
    const therapist = await prisma.therapistProfile.findUnique({
        where: { id: therapistId },
    });

    if (!therapist || !therapist.stripeAccountId) {
        return {
            connected: false,
            detailsSubmitted: false,
            chargesEnabled: false,
            payoutsEnabled: false,
        };
    }

    const account = await stripe.accounts.retrieve(therapist.stripeAccountId);
    const req = account.requirements ?? {};
    const futureReq = account.future_requirements ?? {};

    const currentlyDueCount = req.currently_due?.length ?? 0;
    const pastDueCount = req.past_due?.length ?? 0;
    const futureDueCount =
        (futureReq.currently_due?.length ?? 0) +
        (futureReq.eventually_due?.length ?? 0);

    return {
        connected: true,
        accountId: therapist.stripeAccountId,
        detailsSubmitted: account.details_submitted,
        chargesEnabled: account.charges_enabled,
        payoutsEnabled: account.payouts_enabled,
        // Why charges are disabled — "requirements.past_due", "under_review", etc.
        disabledReason: req.disabled_reason ?? null,
        // Stage 3 — past_due: account restricted, immediate action required
        pastDueCount,
        // Stage 2 — currently_due: action required before current_deadline
        currentlyDueCount,
        currentDeadline: req.current_deadline ?? null, // Unix timestamp
        // Stage 1 — upcoming requirements not yet affecting capabilities
        hasUpcomingRequirements: futureDueCount > 0,
        futureDeadline: futureReq.current_deadline ?? null, // Unix timestamp
    };
};

// createDashboardLink removed — the external Stripe Express Dashboard is
// replaced by the embedded ConnectBalances component in the earnings page.

/**
 * List customer's saved payment methods from Stripe
 */
const getPaymentMethods = async (userId) => {
    const customerProfile = await prisma.customerProfile.findUnique({
        where: { userId },
    });

    if (!customerProfile?.stripeCustomerId) {
        return [];
    }

    const paymentMethods = await stripe.paymentMethods.list({
        customer: customerProfile.stripeCustomerId,
        type: "card",
    });

    // Get customer's default payment method
    const customer = await stripe.customers.retrieve(customerProfile.stripeCustomerId);
    const defaultPmId = customer.invoice_settings?.default_payment_method;

    // Deduplicate by card fingerprint — keep the default or most recent, detach extras
    const seen = new Map(); // fingerprint -> paymentMethod
    const duplicates = [];

    for (const pm of paymentMethods.data) {
        const fingerprint = pm.card.fingerprint;
        const existing = seen.get(fingerprint);

        if (!existing) {
            seen.set(fingerprint, pm);
        } else {
            // Keep the default one, or the newer one
            const existingIsDefault = existing.id === defaultPmId;
            const currentIsDefault = pm.id === defaultPmId;

            if (currentIsDefault || (!existingIsDefault && pm.created > existing.created)) {
                duplicates.push(existing.id);
                seen.set(fingerprint, pm);
            } else {
                duplicates.push(pm.id);
            }
        }
    }

    // Detach duplicates in background (don't block the response)
    if (duplicates.length > 0) {
        Promise.allSettled(
            duplicates.map((id) => stripe.paymentMethods.detach(id))
        ).catch(() => { });
    }

    const unique = Array.from(seen.values());
    return unique.map((pm) => ({
        id: pm.id,
        brand: pm.card.brand,
        last4: pm.card.last4,
        expMonth: pm.card.exp_month,
        expYear: pm.card.exp_year,
        isDefault: pm.id === defaultPmId,
    }));
};

/**
 * Create a Stripe SetupIntent for saving a card without charging
 */
const createSetupIntent = async (userId) => {
    const { stripeCustomerId } = await getOrCreateStripeCustomer(userId);

    const setupIntent = await stripe.setupIntents.create({
        customer: stripeCustomerId,
        payment_method_types: ["card"],
    });

    return { clientSecret: setupIntent.client_secret };
};

/**
 * Detach a saved payment method from the customer
 */
const removePaymentMethod = async (userId, paymentMethodId) => {
    const customerProfile = await prisma.customerProfile.findUnique({
        where: { userId },
    });

    if (!customerProfile?.stripeCustomerId) {
        throw new Error("No Stripe customer found");
    }

    // Verify the payment method belongs to this customer
    const pm = await stripe.paymentMethods.retrieve(paymentMethodId);
    if (pm.customer !== customerProfile.stripeCustomerId) {
        throw new Error("Payment method does not belong to this customer");
    }

    await stripe.paymentMethods.detach(paymentMethodId);
    return { success: true };
};

/**
 * Set a payment method as the customer's default
 */
const setDefaultPaymentMethod = async (userId, paymentMethodId) => {
    const customerProfile = await prisma.customerProfile.findUnique({
        where: { userId },
    });

    if (!customerProfile?.stripeCustomerId) {
        throw new Error("No Stripe customer found");
    }

    // Verify the payment method belongs to this customer
    const pm = await stripe.paymentMethods.retrieve(paymentMethodId);
    if (pm.customer !== customerProfile.stripeCustomerId) {
        throw new Error("Payment method does not belong to this customer");
    }

    await stripe.customers.update(customerProfile.stripeCustomerId, {
        invoice_settings: { default_payment_method: paymentMethodId },
    });

    return { success: true };
};

// ─── Customer Connect Account (for receiving refunds) ───



/**
 * Create or retrieve a Stripe Connect account for a customer.
 * Customers need Connect accounts to receive refund transfers.
 * Uses Custom (controller) accounts — same pattern as therapists.
 *
 * Only requests `transfers` capability (no card_payments — customers
 * don't process payments, they only receive refund transfers).
 */
const createOrGetCustomerConnectAccount = async (customerId, userId) => {
    const customer = await prisma.customerProfile.findUnique({
        where: { id: customerId },
        include: { user: true },
    });

    if (!customer) throw new Error("Customer not found");
    if (customer.userId !== userId) throw new Error("Unauthorized");

    if (customer.stripeAccountId) {
        return { accountId: customer.stripeAccountId };
    }

    const account = await stripe.accounts.create({
        country: "US",
        email: customer.user.email,
        capabilities: {
            transfers: { requested: true },
        },
        controller: {
            requirement_collection: "application",
            stripe_dashboard: { type: "none" },
            losses: { payments: "application" },
            fees: { payer: "application" },
        },
        metadata: {
            customerId: customer.id,
            userId: customer.userId,
            accountPurpose: "customer_refund_recipient",
        },
    });

    await withAdminAccess(async (db) => {
        await db.customerProfile.update({
            where: { id: customerId },
            data: { stripeAccountId: account.id },
        });
    });

    return { accountId: account.id };
};

/**
 * Create an Account Session for customer Connect embedded components.
 * Customers only need: account_onboarding + balances (to see refund payouts).
 * No payments component — customers don't process payments.
 */
const createCustomerAccountSession = async (customerId, userId) => {
    const customer = await prisma.customerProfile.findUnique({
        where: { id: customerId },
    });

    if (!customer) throw new Error("Customer not found");
    if (customer.userId !== userId) throw new Error("Unauthorized");
    if (!customer.stripeAccountId) {
        throw new Error("No payout account connected. Please set up your payout account first.");
    }

    const account = await stripe.accounts.retrieve(customer.stripeAccountId);
    const platformOwnsRequirements =
        account?.controller?.requirement_collection === "application";

    const session = await stripe.accountSessions.create({
        account: customer.stripeAccountId,
        components: {
            account_onboarding: {
                enabled: true,
                features: {
                    ...(platformOwnsRequirements && {
                        disable_stripe_user_authentication: true,
                    }),
                    external_account_collection: true,
                },
            },
            balances: {
                enabled: true,
                features: {
                    instant_payouts: false,
                    standard_payouts: true,
                    edit_payout_schedule: false,
                    external_account_collection: true,
                    ...(platformOwnsRequirements && {
                        disable_stripe_user_authentication: true,
                    }),
                },
            },
        },
    });

    return { clientSecret: session.client_secret };
};

/**
 * Get Connect account status for a customer.
 */
const getCustomerConnectStatus = async (customerId, userId) => {
    const customer = await prisma.customerProfile.findUnique({
        where: { id: customerId },
    });

    if (!customer) throw new Error("Customer not found");
    if (customer.userId !== userId) throw new Error("Unauthorized");

    if (!customer.stripeAccountId) {
        return {
            connected: false,
            detailsSubmitted: false,
            payoutsEnabled: false,
            onboardingComplete: false,
        };
    }

    const account = await stripe.accounts.retrieve(customer.stripeAccountId);

    return {
        connected: true,
        detailsSubmitted: account.details_submitted || false,
        payoutsEnabled: account.payouts_enabled || false,
        onboardingComplete: customer.stripeOnboardingComplete,
    };
};

/**
 * Get customer refund summary (for the Payments & Refunds dashboard).
 *
 * Source of truth:
 *   - totalPaid:    sum(payment.amount)
 *   - inEscrow:     sum(payment.amount - payment.refundedAmount) for escrowed/partially_released
 *                   (subtract refunds because that money is no longer in escrow)
 *   - totalRefunded: sum(customerRefund.amount where status=transferred OR refunded_to_card)
 *                    + legacy card refunds on payments that pre-date CustomerRefund (no rows linked)
 *   - pendingAmount: sum(customerRefund.amount where status=pending_connect)
 *
 */
const getCustomerRefundSummary = async (customerId) => {
    const payments = await prisma.payment.findMany({
        where: { customerId },
        select: {
            id: true,
            amount: true,
            platformFee: true,
            status: true,
            releasedAmount: true,
            refundedAmount: true,
            customerRefunds: { select: { id: true } },
            booking: { select: { status: true } },
        },
    });

    const totalPaid = payments.reduce((sum, p) => sum + parseFloat(p.amount), 0);

    const inEscrow = payments
        .filter(p =>
            ["escrowed", "partially_released"].includes(p.status) &&
            !["finalized", "cancelled"].includes(p.booking?.status)
        )
        .reduce((sum, p) => {
            const amount = parseFloat(p.amount);
            const fee = parseFloat(p.platformFee ?? 0);
            const feeRatio = amount > 0 ? fee / amount : 0;
            const releasedNet = p.releasedAmount ? parseFloat(p.releasedAmount) : 0;
            const grossReleased = feeRatio < 1 ? releasedNet / (1 - feeRatio) : releasedNet;
            const refunded = p.refundedAmount ? parseFloat(p.refundedAmount) : 0;
            return sum + Math.max(0, parseFloat((amount - grossReleased - refunded).toFixed(2)));
        }, 0);

    const refunds = await prisma.customerRefund.findMany({
        where: { customerId },
        select: { amount: true, status: true, expiresAt: true },
    });

    const transferredRefunds = refunds
        .filter(r => r.status === "transferred")
        .reduce((sum, r) => sum + parseFloat(r.amount), 0);

    const cardRefunds = refunds
        .filter(r => r.status === "refunded_to_card")
        .reduce((sum, r) => sum + parseFloat(r.amount), 0);

    // Legacy card refunds: payments with refundedAmount but no linked CustomerRefund
    // (these are pre-Phase-1 refunds done via direct stripe.refunds.create).
    // For new flows, refundedAmount mirrors CustomerRefund.amount — counting both would double.
    const legacyCardRefunded = payments
        .filter(p => p.refundedAmount && p.customerRefunds.length === 0)
        .reduce((sum, p) => sum + parseFloat(p.refundedAmount), 0);

    const totalRefunded = transferredRefunds + cardRefunds + legacyCardRefunded;

    const pendingRefunds = refunds.filter(r => r.status === "pending_connect");
    const pendingAmount = pendingRefunds.reduce((sum, r) => sum + parseFloat(r.amount), 0);

    // Nearest expiry for pending refunds
    const nearestExpiry = pendingRefunds.length > 0
        ? pendingRefunds.reduce((min, r) => r.expiresAt < min ? r.expiresAt : min, pendingRefunds[0].expiresAt)
        : null;

    return {
        totalPaid: parseFloat(totalPaid.toFixed(2)),
        inEscrow: parseFloat(inEscrow.toFixed(2)),
        totalRefunded: parseFloat(totalRefunded.toFixed(2)),
        pendingRefundAmount: parseFloat(pendingAmount.toFixed(2)),
        pendingRefundCount: pendingRefunds.length,
        nearestExpiryDate: nearestExpiry,
    };
};

/**
 * Get customer refund history.
 */
const getCustomerRefundHistory = async (customerId) => {
    const refunds = await prisma.customerRefund.findMany({
        where: { customerId },
        include: {
            booking: {
                select: {
                    id: true,
                    sessionType: true,
                    therapist: { select: { fullName: true, profilePhotoUrl: true } },
                },
            },
        },
        orderBy: { createdAt: "desc" },
    });

    return refunds;
};

/**
 * Transfer a pending refund to a customer's Connect account.
 * Called when:
 *   1. Customer finishes Connect onboarding (webhook triggers this)
 *   2. Admin manually triggers a pending refund transfer
 *
 * Idempotent: if the refund already has a stripeTransferId, it's a no-op.
 */
const transferPendingRefund = async (refundId) => {
    const refund = await prisma.customerRefund.findUnique({
        where: { id: refundId },
        include: {
            customer: {
                include: { user: { select: { email: true } } },
            },
        },
    });

    if (!refund) throw new Error("Refund not found");
    if (refund.status !== "pending_connect") {
        logger.info(`[PaymentService] Refund ${refundId} is not pending_connect (status: ${refund.status}), skipping`);
        return refund;
    }
    if (refund.stripeTransferId) {
        logger.info(`[PaymentService] Refund ${refundId} already has transfer ${refund.stripeTransferId}, skipping`);
        return refund;
    }

    if (!refund.customer.stripeAccountId) {
        throw new Error("Customer does not have a Connect account");
    }

    const transfer = await stripe.transfers.create({
        amount: Math.round(parseFloat(refund.amount) * 100),
        currency: "usd",
        destination: refund.customer.stripeAccountId,
        metadata: {
            type: "customer_refund",
            customerRefundId: refund.id,
            bookingId: refund.bookingId,
            paymentId: refund.paymentId,
        },
    }, {
        idempotencyKey: `customer-refund-${refund.id}`,
    });

    const updated = await prisma.customerRefund.update({
        where: { id: refundId },
        data: {
            status: "transferred",
            stripeTransferId: transfer.id,
            transferredAt: new Date(),
        },
    });

    logger.info("[PaymentService] Customer refund transferred", {
        refundId,
        amount: parseFloat(refund.amount),
        customerId: refund.customerId,
        transferId: transfer.id,
    });

    // Notify customer
    sendCustomerRefundTransferred({
        customer: refund.customer,
        refundAmount: parseFloat(refund.amount),
    }).catch(() => { });

    return updated;
};

/**
 * Process all pending refunds for a customer who just completed Connect onboarding.
 * Called from the account.updated webhook when payouts_enabled flips to true.
 */
const processPendingRefundsForCustomer = async (customerId) => {
    const pendingRefunds = await prisma.customerRefund.findMany({
        where: {
            customerId,
            status: "pending_connect",
        },
    });

    if (pendingRefunds.length === 0) return [];

    // Transfer all pending refunds in parallel — each is independent (separate
    // Stripe transfer + DB update). Promise.allSettled ensures one failure does
    // not block the others.
    const settled = await Promise.allSettled(
        pendingRefunds.map((refund) => transferPendingRefund(refund.id))
    );

    const results = settled.map((result, i) => {
        const refund = pendingRefunds[i];
        if (result.status === "fulfilled") {
            return { refundId: refund.id, status: "transferred", transferId: result.value.stripeTransferId };
        }
        logger.error("[PaymentService] Failed to transfer pending refund", {
            refundId: refund.id,
            error: result.reason?.message,
        });
        return { refundId: refund.id, status: "failed", error: result.reason?.message };
    });

    return results;
};

/**
 */

/**
 * Create a per-session refund. Used by:
 *   - Missed visit flow (therapist/customer marks a session as missed)
 *   - Any future per-session refund scenarios
 *
 * Behavior:
 *   - If customer has a verified Connect account: immediate Stripe transfer
 *   - Otherwise: creates a `pending_connect` CustomerRefund record. Customer
 *     will see it on their Payments page and can set up Connect to claim it.
 *     If unclaimed after 30 days, the cron fallback issues a card refund.
 *
 * Idempotent guard: caller must ensure there's no existing refund for this session.
 * (The session status check in markSessionMissed already prevents double-marking.)
 *
 * @param {object} opts
 * @param {object} opts.session - { id, bookingId }
 * @param {object} opts.payment - { id, stripePaymentIntentId }
 * @param {object} opts.customer - CustomerProfile with { id, stripeAccountId, stripeOnboardingComplete, user: { email } }
 * @param {object} opts.booking - { id, rate }
 * @param {string} opts.reason - e.g. "missed_visit_by_therapist", "missed_visit_by_customer", "attempted_visit_remainder"
 * @param {number} [opts.amount] - Optional override. Defaults to full booking.rate (missed-visit behavior).
 *                                 For attempted visits, pass `booking.rate - attemptedVisitRate`.
 * @returns {Promise<{customerRefund, transfer}>}
 */
const createPerSessionRefund = async ({ session, payment, customer, booking, reason, amount }) => {
    const rawAmount = amount != null ? Number(amount) : parseFloat(booking.rate);
    const refundAmount = Math.round(rawAmount * 100) / 100;

    if (!Number.isFinite(refundAmount) || refundAmount <= 0) {
        throw new Error("Invalid refund amount");
    }

    let customerRefund = null;
    let transfer = null;

    // If customer has a verified Connect account, transfer immediately
    if (customer.stripeAccountId && customer.stripeOnboardingComplete) {
        try {
            transfer = await stripe.transfers.create({
                amount: Math.round(refundAmount * 100),
                currency: "usd",
                destination: customer.stripeAccountId,
                metadata: {
                    type: "customer_refund",
                    reason,
                    bookingId: booking.id,
                    paymentId: payment.id,
                    sessionId: session.id,
                },
            }, {
                idempotencyKey: `per-session-refund-${session.id}`,
            });

            customerRefund = await prisma.customerRefund.create({
                data: {
                    customerId: customer.id,
                    paymentId: payment.id,
                    bookingId: booking.id,
                    sessionId: session.id,
                    amount: refundAmount,
                    status: "transferred",
                    stripeTransferId: transfer.id,
                    transferredAt: new Date(),
                    reason,
                },
            });

            logger.info("[PaymentService] Per-session refund transferred to customer Connect account", {
                sessionId: session.id,
                refundAmount,
                transferId: transfer.id,
            });
        } catch (stripeError) {
            logger.error("[PaymentService] Per-session refund transfer failed — creating pending record instead", {
                sessionId: session.id,
                refundAmount,
                error: stripeError.message,
            });
            // Fall through to pending_connect path below
        }
    }

    if (!customerRefund) {
        customerRefund = await prisma.customerRefund.create({
            data: {
                customerId: customer.id,
                paymentId: payment.id,
                bookingId: booking.id,
                sessionId: session.id,
                amount: refundAmount,
                status: "pending_connect",
                reason,
            },
        });

        logger.info("[PaymentService] Per-session refund pending (awaiting customer Connect setup)", {
            sessionId: session.id,
            refundAmount,
            expiresAt: customerRefund.expiresAt,
        });
    }

    // Update payment.refundedAmount cumulatively (not replaced).
    // Prisma `increment` on a NULL column yields NULL (NULL + n = NULL in SQL),
    // so we manually compute the new total to handle the first-refund case.
    const currentPayment = await prisma.payment.findUnique({
        where: { id: payment.id },
        select: { refundedAmount: true },
    });
    const currentRefunded = currentPayment?.refundedAmount ? parseFloat(currentPayment.refundedAmount) : 0;
    await prisma.payment.update({
        where: { id: payment.id },
        data: {
            refundedAmount: currentRefunded + refundAmount,
            refundedAt: new Date(),
        },
    });

    // Notify customer
    if (customerRefund.status === "transferred") {
        sendCustomerRefundTransferred({
            customer,
            refundAmount,
        }).catch(() => { });
    } else {
        sendCustomerRefundAvailable({
            customer,
            therapist: booking.therapist || { fullName: "Your therapist" },
            refundAmount,
            bookingId: booking.id,
        }).catch(() => { });
    }

    return { customerRefund, transfer };
};

export {
    createPaymentIntent,
    handlePaymentSuccess,
    releasePayment,
    releaseSessionPayout,
    releasePartialSessionPayout,
    finalizeBooking,
    processRefund,
    getCustomerPaymentHistory,
    getTherapistPayoutHistory,
    createOrGetConnectAccount,
    createAccountSession,
    getConnectAccountStatus,
    getOrCreateStripeCustomer,
    getPaymentMethods,
    createSetupIntent,
    removePaymentMethod,
    setDefaultPaymentMethod,
    createOrGetCustomerConnectAccount,
    createCustomerAccountSession,
    getCustomerConnectStatus,
    getCustomerRefundSummary,
    getCustomerRefundHistory,
    transferPendingRefund,
    processPendingRefundsForCustomer,
    createPerSessionRefund,
}