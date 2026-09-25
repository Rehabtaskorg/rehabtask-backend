import { BOOKING_STATUS, SESSION_STATUS, STRIPE_BUSINESS_STRUCTURE, STRIPE_COMPANY_STRUCTURES, STRIPE_CAPABILITY, CUSTOMER_TYPES } from "../utils/constants.js";
import { isConnectAccountReady } from "../utils/stripe.helpers.js";
import { prisma, withAdminAccess } from "../config/prisma.js";
import { stripe } from "../config/stripe.js";
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";
import { getOrCreateStripeCustomer } from "./payment.shared.js";
import { THERAPIST_SAFE_SELECT } from "../utils/therapistContactAccess.js";

export const getCustomerPaymentHistory = async (customerId) => {
    return prisma.payment.findMany({
        where: { customerId },
        include: {
            booking: {
                include: {
                    therapist: { select: THERAPIST_SAFE_SELECT },
                    offer: { include: { request: true } },
                    sessions: { orderBy: { sessionNumber: "asc" } },
                },
            },
            customerRefunds: {
                select: { id: true, amount: true, status: true, reason: true, transferredAt: true, fallbackRefundAt: true, expiresAt: true, createdAt: true },
                orderBy: { createdAt: "desc" },
            },
        },
        orderBy: { createdAt: "desc" },
    });
};

export const getTherapistPayoutHistory = async (therapistId) => {
    const [payments, therapist] = await Promise.all([
        prisma.payment.findMany({
            where: { therapistId, status: { in: ["released", "partially_released", "escrowed"] } },
            include: {
                sessionPayouts: { orderBy: { createdAt: "desc" } },
                booking: {
                    include: {
                        customer: true,
                        sessions: { select: { id: true, status: true } },
                        offer: { include: { request: true } },
                    },
                },
            },
            orderBy: { createdAt: "desc" },
        }),
        prisma.therapistProfile.findUnique({ where: { id: therapistId }, select: { planTier: true } }),
    ]);

    const releasedPayments = payments.filter((p) => ["released", "partially_released"].includes(p.status));
    const escrowedPayments = payments.filter((p) =>
        p.status === "escrowed" &&
        ![BOOKING_STATUS.FINALIZED, BOOKING_STATUS.CANCELLED].includes(p.booking?.status)
    );

    const getAdjustedPayout = (p) => {
        const sessions = p.booking?.sessions || [];
        const total = sessions.length;
        if (total <= 1) return parseFloat(p.therapistPayout);
        const missedOrCancelled = sessions.filter((s) =>
            s.status === SESSION_STATUS.MISSED || s.status === SESSION_STATUS.CANCELLED
        ).length;
        if (missedOrCancelled === 0) return parseFloat(p.therapistPayout);
        const deliverable = Math.max(0, total - missedOrCancelled);
        return parseFloat(((parseFloat(p.therapistPayout) / total) * deliverable).toFixed(2));
    };

    const totalEarnings = releasedPayments.reduce((sum, p) => sum + parseFloat(p.releasedAmount ?? p.therapistPayout), 0);

    const pendingEarnings =
        escrowedPayments.reduce((sum, p) => sum + getAdjustedPayout(p), 0) +
        payments
            .filter((p) => p.status === "partially_released")
            .reduce((sum, p) => sum + Math.max(0, getAdjustedPayout(p) - parseFloat(p.releasedAmount ?? 0)), 0);

    const pendingSessionCount = [...escrowedPayments, ...payments.filter((p) => p.status === "partially_released")]
        .reduce((count, p) => {
            const sessions = p.booking?.sessions || [];
            return count + sessions.filter((s) =>
                ![SESSION_STATUS.CONFIRMED_BY_CUSTOMER, SESSION_STATUS.CANCELLED, SESSION_STATUS.MISSED, SESSION_STATUS.ATTEMPTED].includes(s.status)
            ).length;
        }, 0);

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

    const globalRate = await prisma.commissionConfig.findFirst({
        where: { tier: null, effectiveFrom: { lte: new Date() } },
        orderBy: { effectiveFrom: "desc" },
    });
    const commissionInfo = {
        planTier: therapist?.planTier ?? "basic",
        commissionRate: globalRate ? parseFloat(globalRate.rate) : 0.1,
    };

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

    return { payments, totalEarnings, pendingEarnings, pendingSessionCount, earningsByMonth, commissionInfo, periodStats };
};

export const getCustomerRefundSummary = async (customerId) => {
    const payments = await prisma.payment.findMany({
        where: { customerId },
        select: {
            id: true, amount: true, platformFee: true, status: true,
            releasedAmount: true, refundedAmount: true,
            customerRefunds: { select: { id: true } },
            booking: { select: { status: true } },
        },
    });

    const totalPaid = payments.reduce((sum, p) => sum + parseFloat(p.amount), 0);

    const inEscrow = payments
        .filter((p) =>
            ["escrowed", "partially_released"].includes(p.status) &&
            ![BOOKING_STATUS.FINALIZED, BOOKING_STATUS.CANCELLED].includes(p.booking?.status)
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

    const transferredRefunds = refunds.filter((r) => r.status === "transferred").reduce((sum, r) => sum + parseFloat(r.amount), 0);
    const cardRefunds = refunds.filter((r) => r.status === "refunded_to_card").reduce((sum, r) => sum + parseFloat(r.amount), 0);
    const legacyCardRefunded = payments
        .filter((p) => p.refundedAmount && p.customerRefunds.length === 0)
        .reduce((sum, p) => sum + parseFloat(p.refundedAmount), 0);

    const totalRefunded = transferredRefunds + cardRefunds + legacyCardRefunded;

    const pendingRefunds = refunds.filter((r) => r.status === "pending_connect");
    const pendingAmount = pendingRefunds.reduce((sum, r) => sum + parseFloat(r.amount), 0);
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

export const getCustomerRefundHistory = async (customerId) => {
    return prisma.customerRefund.findMany({
        where: { customerId },
        include: {
            booking: {
                select: {
                    id: true, sessionType: true,
                    therapist: { select: { fullName: true, profilePhotoUrl: true } },
                },
            },
        },
        orderBy: { createdAt: "desc" },
    });
};

export const getConnectAccountStatus = async (therapistId) => {
    const therapist = await prisma.therapistProfile.findUnique({ where: { id: therapistId } });

    if (!therapist || !therapist.stripeAccountId) {
        return { connected: false, detailsSubmitted: false, transfersActive: false, payoutsEnabled: false, onboardingComplete: false };
    }

    const account = await stripe.accounts.retrieve(therapist.stripeAccountId);
    const req = account.requirements ?? {};
    const futureReq = account.future_requirements ?? {};

    const currentlyDueCount = req.currently_due?.length ?? 0;
    const pastDueCount = req.past_due?.length ?? 0;
    const eventuallyDueCount = req.eventually_due?.length ?? 0;
    const futureDueCount = eventuallyDueCount + (futureReq.currently_due?.length ?? 0) + (futureReq.eventually_due?.length ?? 0);

    return {
        connected: true,
        detailsSubmitted: account.details_submitted,
        transfersActive: account.capabilities?.transfers === STRIPE_CAPABILITY.ACTIVE,
        payoutsEnabled: account.payouts_enabled,
        onboardingComplete: isConnectAccountReady(account),
        disabledReason: req.disabled_reason ?? null,
        pastDueCount,
        currentlyDueCount,
        currentDeadline: req.current_deadline ?? null,
        hasUpcomingRequirements: futureDueCount > 0,
        futureDeadline: futureReq.current_deadline ?? null,
    };
};

export const getCustomerConnectStatus = async (customerId, userId) => {
    const customer = await prisma.customerProfile.findUnique({ where: { id: customerId } });

    if (!customer) throw new Error("Customer not found");
    if (customer.userId !== userId) throw new Error("Unauthorized");

    if (!customer.stripeAccountId) {
        return { connected: false, detailsSubmitted: false, payoutsEnabled: false, onboardingComplete: false };
    }

    const account = await stripe.accounts.retrieve(customer.stripeAccountId);
    const req = account.requirements ?? {};
    const futureReq = account.future_requirements ?? {};

    const onboardingComplete = isConnectAccountReady(account);
    const currentlyDueCount = req.currently_due?.length ?? 0;
    const pastDueCount = req.past_due?.length ?? 0;
    const eventuallyDueCount = req.eventually_due?.length ?? 0;
    const futureDueCount = eventuallyDueCount + (futureReq.currently_due?.length ?? 0) + (futureReq.eventually_due?.length ?? 0);

    return {
        connected: true,
        detailsSubmitted: account.details_submitted || false,
        payoutsEnabled: account.payouts_enabled || false,
        onboardingComplete,
        disabledReason: req.disabled_reason ?? null,
        pastDueCount,
        currentlyDueCount,
        currentDeadline: req.current_deadline ?? null,
        hasUpcomingRequirements: futureDueCount > 0,
        futureDeadline: futureReq.current_deadline ?? null,
    };
};

export const getPaymentMethods = async (userId) => {
    const customerProfile = await prisma.customerProfile.findUnique({ where: { userId } });

    if (!customerProfile?.stripeCustomerId) return [];

    const paymentMethods = await stripe.paymentMethods.list({ customer: customerProfile.stripeCustomerId, type: "card" });
    const stripeCustomer = await stripe.customers.retrieve(customerProfile.stripeCustomerId);
    const defaultPmId = stripeCustomer.invoice_settings?.default_payment_method;

    const seen = new Map();
    const duplicates = [];

    for (const pm of paymentMethods.data) {
        const fingerprint = pm.card.fingerprint;
        const existing = seen.get(fingerprint);

        if (!existing) {
            seen.set(fingerprint, pm);
        } else {
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

    if (duplicates.length > 0) {
        Promise.allSettled(duplicates.map((id) => stripe.paymentMethods.detach(id))).catch(() => { });
    }

    return Array.from(seen.values()).map((pm) => ({
        id: pm.id,
        brand: pm.card.brand,
        last4: pm.card.last4,
        expMonth: pm.card.exp_month,
        expYear: pm.card.exp_year,
        isDefault: pm.id === defaultPmId,
    }));
};

export const createSetupIntent = async (userId) => {
    const { stripeCustomerId } = await getOrCreateStripeCustomer(userId);
    const setupIntent = await stripe.setupIntents.create({ customer: stripeCustomerId, payment_method_types: ["card"] });
    return { clientSecret: setupIntent.client_secret };
};

export const removePaymentMethod = async (userId, paymentMethodId) => {
    const customerProfile = await prisma.customerProfile.findUnique({ where: { userId } });
    if (!customerProfile?.stripeCustomerId) throw new Error("No Stripe customer found");

    const pm = await stripe.paymentMethods.retrieve(paymentMethodId);
    if (pm.customer !== customerProfile.stripeCustomerId) throw new Error("Payment method does not belong to this customer");

    await stripe.paymentMethods.detach(paymentMethodId);
    return { success: true };
};

export const setDefaultPaymentMethod = async (userId, paymentMethodId) => {
    const customerProfile = await prisma.customerProfile.findUnique({ where: { userId } });
    if (!customerProfile?.stripeCustomerId) throw new Error("No Stripe customer found");

    const pm = await stripe.paymentMethods.retrieve(paymentMethodId);
    if (pm.customer !== customerProfile.stripeCustomerId) throw new Error("Payment method does not belong to this customer");

    await stripe.customers.update(customerProfile.stripeCustomerId, { invoice_settings: { default_payment_method: paymentMethodId } });
    return { success: true };
};

export const createOrGetConnectAccount = async (therapistId, userId, businessStructure, productDescription) => {
    const therapist = await prisma.therapistProfile.findUnique({ where: { id: therapistId }, include: { user: true } });
    if (!therapist) throw new Error("Therapist not found");
    if (therapist.userId !== userId) throw new Error("Unauthorized");
    if (therapist.stripeAccountId) return { accountId: therapist.stripeAccountId };

    const isCompany = STRIPE_COMPANY_STRUCTURES.has(businessStructure);
    const businessType = isCompany ? "company" : "individual";

    const accountParams = {
        country: "US",
        email: therapist.user.email,
        capabilities: { transfers: { requested: true } },
        controller: {
            requirement_collection: "application",
            stripe_dashboard: { type: "none" },
            losses: { payments: "application" },
            fees: { payer: "application" },
        },
        business_type: businessType,
        business_profile: { product_description: productDescription.trim(), mcc: "8099" },
        metadata: { therapistId: therapist.id, userId: therapist.userId },
    };

    if (isCompany) {
        accountParams.company = { structure: businessStructure };
    }

    const account = await stripe.accounts.create(accountParams);

    await withAdminAccess(async (db) => {
        await db.therapistProfile.update({
            where: { id: therapistId },
            data: { stripeAccountId: account.id, stripeBusinessStructure: businessStructure },
        });
    });

    return { accountId: account.id };
};

export const createAccountSession = async (therapistId, userId) => {
    const therapist = await prisma.therapistProfile.findUnique({ where: { id: therapistId } });
    if (!therapist) throw new Error("Therapist not found");
    if (therapist.userId !== userId) throw new Error("Unauthorized");
    if (!therapist.stripeAccountId) throw new Error("No Stripe account connected. Please complete account setup first.");

    const account = await stripe.accounts.retrieve(therapist.stripeAccountId);
    const platformOwnsRequirements = account?.controller?.requirement_collection === "application";

    const session = await stripe.accountSessions.create({
        account: therapist.stripeAccountId,
        components: {
            account_onboarding: {
                enabled: true,
                features: {
                    ...(platformOwnsRequirements && { disable_stripe_user_authentication: true }),
                    external_account_collection: true,
                },
            },
            balances: {
                enabled: true,
                features: {
                    instant_payouts: false,
                    standard_payouts: true,
                    edit_payout_schedule: true,
                    external_account_collection: true,
                    ...(platformOwnsRequirements && { disable_stripe_user_authentication: true }),
                },
            },
            payouts_list: { enabled: true },
        },
    });

    return { clientSecret: session.client_secret };
};

export const createOrGetCustomerConnectAccount = async (customerId, userId, businessStructure) => {
    const customer = await prisma.customerProfile.findUnique({ where: { id: customerId }, include: { user: true } });
    if (!customer) throw new Error("Customer not found");
    if (customer.userId !== userId) throw new Error("Unauthorized");
    if (customer.stripeAccountId) return { accountId: customer.stripeAccountId };

    const isAgency = customer.customerType === CUSTOMER_TYPES.AGENCY;
    if (isAgency && businessStructure === STRIPE_BUSINESS_STRUCTURE.INDIVIDUAL) {
        throw new Error("Agency accounts must select a registered business structure");
    }
    if (!isAgency && businessStructure !== STRIPE_BUSINESS_STRUCTURE.INDIVIDUAL) {
        throw new Error("Individual accounts must select the individual business structure");
    }

    const accountParams = {
        country: "US",
        email: customer.user.email,
        capabilities: { transfers: { requested: true } },
        controller: {
            requirement_collection: "application",
            stripe_dashboard: { type: "none" },
            losses: { payments: "application" },
            fees: { payer: "application" },
        },
        business_type: isAgency ? "company" : "individual",
        business_profile: { url: env.FRONTEND_URL, mcc: "8099" },
        metadata: { customerId: customer.id, userId: customer.userId, accountPurpose: "customer_refund_recipient" },
    };

    if (isAgency) {
        accountParams.company = {
            ...(businessStructure !== STRIPE_BUSINESS_STRUCTURE.SOLE_PROPRIETORSHIP && { structure: businessStructure }),
            name: customer.agencyName ?? undefined,
        };
    }

    const account = await stripe.accounts.create(accountParams);

    await withAdminAccess(async (db) => {
        await db.customerProfile.update({
            where: { id: customerId },
            data: { stripeAccountId: account.id, stripeBusinessStructure: businessStructure },
        });
    });

    return { accountId: account.id };
};

export const createCustomerAccountSession = async (customerId, userId) => {
    const customer = await prisma.customerProfile.findUnique({ where: { id: customerId } });
    if (!customer) throw new Error("Customer not found");
    if (customer.userId !== userId) throw new Error("Unauthorized");
    if (!customer.stripeAccountId) throw new Error("No payout account connected. Please set up your payout account first.");

    const account = await stripe.accounts.retrieve(customer.stripeAccountId);
    const platformOwnsRequirements = account?.controller?.requirement_collection === "application";

    const session = await stripe.accountSessions.create({
        account: customer.stripeAccountId,
        components: {
            account_onboarding: {
                enabled: true,
                features: {
                    ...(platformOwnsRequirements && { disable_stripe_user_authentication: true }),
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
                    ...(platformOwnsRequirements && { disable_stripe_user_authentication: true }),
                },
            },
        },
    });

    return { clientSecret: session.client_secret };
};
