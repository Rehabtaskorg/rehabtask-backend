import { prisma } from "../config/prisma.js";
import { NotFoundError } from "../utils/errors.js";

export const PAYMENT_INCLUDE = {
    booking: {
        select: {
            id: true, scheduledDate: true, sessionType: true, status: true,
            sessions: { select: { id: true, sessionNumber: true, status: true, scheduledDate: true }, orderBy: { sessionNumber: "asc" } },
        },
    },
    customer: {
        select: {
            id: true,
            userId: true,
            fullName: true,
            user: { select: { email: true } },
        },
    },
    therapist: {
        select: {
            id: true,
            userId: true,
            fullName: true,
            stripeAccountId: true,
            user: { select: { email: true } },
        },
    },
};

const VALID_SORT_FIELDS = ["createdAt", "amount"];

/**
 * @param {{ status?, search?, sortBy?, sortOrder?, startDate?, endDate?, page?, limit? }} opts
 */
export const adminListPayments = async ({
    status,
    search,
    sortBy = "createdAt",
    sortOrder = "desc",
    startDate,
    endDate,
    page = 1,
    limit = 20,
} = {}) => {
    const where = {};
    if (status) where.status = status;

    if (startDate || endDate) {
        where.createdAt = {};
        if (startDate) where.createdAt.gte = new Date(startDate);
        if (endDate) {
            const end = new Date(endDate);
            end.setUTCHours(23, 59, 59, 999);
            where.createdAt.lte = end;
        }
    }

    if (search?.trim()) {
        const term = search.trim();
        where.OR = [
            { customer: { fullName: { contains: term, mode: "insensitive" } } },
            { customer: { user: { email: { contains: term, mode: "insensitive" } } } },
            { therapist: { fullName: { contains: term, mode: "insensitive" } } },
            { therapist: { user: { email: { contains: term, mode: "insensitive" } } } },
        ];
    }

    const resolvedSortBy = VALID_SORT_FIELDS.includes(sortBy) ? sortBy : "createdAt";
    const orderBy = { [resolvedSortBy]: sortOrder === "asc" ? "asc" : "desc" };

    const [payments, total] = await Promise.all([
        prisma.payment.findMany({ where, include: PAYMENT_INCLUDE, orderBy, skip: (page - 1) * limit, take: limit }),
        prisma.payment.count({ where }),
    ]);

    return { payments, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
};

/**
 * @param {string} paymentId
 */
export const adminGetPayment = async (paymentId) => {
    const payment = await prisma.payment.findUnique({ where: { id: paymentId }, include: PAYMENT_INCLUDE });
    if (!payment) throw new NotFoundError("Payment not found");
    return payment;
};

/**
 * Aggregate stats across all payments.
 */
export const adminGetPaymentStats = async () => {
    const [totalVolume, platformRevenue, therapistPayouts, refunded, escrowed] = await Promise.all([
        prisma.payment.aggregate({ _sum: { amount: true }, where: { status: { in: ["escrowed", "partially_released", "released"] } } }),
        prisma.payment.aggregate({ _sum: { platformFee: true }, where: { status: { in: ["partially_released", "released"] } } }),
        prisma.payment.aggregate({ _sum: { releasedAmount: true }, where: { status: { in: ["partially_released", "released"] } } }),
        prisma.payment.aggregate({ _sum: { amount: true }, where: { status: "refunded" } }),
        prisma.payment.aggregate({ _sum: { amount: true }, where: { status: { in: ["escrowed", "partially_released"] } } }),
    ]);

    return {
        totalVolume: parseFloat(totalVolume._sum.amount ?? 0),
        platformRevenue: parseFloat(platformRevenue._sum.platformFee ?? 0),
        therapistPayouts: parseFloat(therapistPayouts._sum.releasedAmount ?? 0),
        totalRefunded: parseFloat(refunded._sum.amount ?? 0),
        escrowedFunds: parseFloat(escrowed._sum.amount ?? 0),
    };
};
