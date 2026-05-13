import { prisma } from "../config/prisma.js";
import { BadRequestError } from "../utils/errors.js";
import { REPORT_MS_PER_DAY } from "../utils/constants.js";

const MAX_RANGE_DAYS = 366;

/**
 * Validate date range and return Date objects.
 * Throws BadRequestError if range exceeds MAX_RANGE_DAYS.
 */
const parseDateRange = (startDate, endDate) => {
    const start = new Date(startDate);
    const end = new Date(endDate);
    end.setUTCHours(23, 59, 59, 999);

    const diffMs = end - start;
    const diffDays = diffMs / REPORT_MS_PER_DAY;

    if (diffDays < 0) {
        throw new BadRequestError("startDate must be before endDate");
    }
    if (diffDays > MAX_RANGE_DAYS) {
        throw new BadRequestError(`Date range cannot exceed ${MAX_RANGE_DAYS} days`);
    }

    return { start, end };
};

/**
 * Escape a CSV field value: wrap in quotes, escape internal quotes,
 * and neutralise formula injection (CSV injection / formula injection attack).
 * Any value beginning with =, +, -, @, TAB, or CR is prefixed with a
 * single-quote so Excel / LibreOffice treats it as literal text.
 */
const csvField = (value) => {
    if (value === null || value === undefined) return "";
    let str = String(value);
    if (str.length > 0 && ["=", "+", "-", "@", "\t", "\r"].includes(str[0])) {
        str = `'${str}`;
    }
    str = str.replace(/"/g, '""');
    return `"${str}"`;
};

/**
 * Build a CSV string from an array of row arrays.
 */
const buildCsv = (headers, rows) => {
    const lines = [headers.map(csvField).join(",")];
    for (const row of rows) {
        lines.push(row.map(csvField).join(","));
    }
    return lines.join("\r\n");
};

const fmtDate = (d) => (d ? new Date(d).toISOString() : "");

// ─── Bookings Report ──────────────────────────────────────────────────────────

export const generateBookingsReport = async ({ startDate, endDate, status }) => {
    const { start, end } = parseDateRange(startDate, endDate);

    const where = {
        createdAt: { gte: start, lte: end },
    };
    if (status) where.status = status;

    const bookings = await prisma.booking.findMany({
        where,
        include: {
            customer: {
                select: {
                    fullName: true,
                    user: { select: { email: true } },
                },
            },
            therapist: {
                select: {
                    fullName: true,
                    user: { select: { email: true } },
                },
            },
        },
        orderBy: { createdAt: "desc" },
    });

    const headers = [
        "ID",
        "Customer Name",
        "Customer Email",
        "Therapist Name",
        "Therapist Email",
        "Session Date",
        "Session Type",
        "Rate",
        "Status",
        "Created At",
    ];

    const rows = bookings.map((b) => [
        b.id,
        b.customer?.fullName ?? "",
        b.customer?.user?.email ?? "",
        b.therapist?.fullName ?? "",
        b.therapist?.user?.email ?? "",
        fmtDate(b.scheduledDate),
        b.sessionType ?? "",
        parseFloat(b.rate ?? 0).toFixed(2),
        b.status,
        fmtDate(b.createdAt),
    ]);

    return buildCsv(headers, rows);
};

// ─── Payments Report ──────────────────────────────────────────────────────────

export const generatePaymentsReport = async ({ startDate, endDate, status }) => {
    const { start, end } = parseDateRange(startDate, endDate);

    const where = {
        createdAt: { gte: start, lte: end },
    };
    if (status) where.status = status;

    const payments = await prisma.payment.findMany({
        where,
        include: {
            customer: {
                select: {
                    fullName: true,
                    user: { select: { email: true } },
                },
            },
            therapist: {
                select: {
                    fullName: true,
                    user: { select: { email: true } },
                },
            },
        },
        orderBy: { createdAt: "desc" },
    });

    const headers = [
        "ID",
        "Customer Name",
        "Customer Email",
        "Therapist Name",
        "Therapist Email",
        "Amount",
        "Platform Fee",
        "Therapist Payout",
        "Status",
        "Escrowed At",
        "Released At",
        "Refunded At",
        "Created At",
    ];

    const rows = payments.map((p) => [
        p.id,
        p.customer?.fullName ?? "",
        p.customer?.user?.email ?? "",
        p.therapist?.fullName ?? "",
        p.therapist?.user?.email ?? "",
        parseFloat(p.amount ?? 0).toFixed(2),
        parseFloat(p.platformFee ?? 0).toFixed(2),
        parseFloat(p.therapistPayout ?? 0).toFixed(2),
        p.status,
        fmtDate(p.escrowedAt),
        fmtDate(p.releasedAt),
        fmtDate(p.refundedAt),
        fmtDate(p.createdAt),
    ]);

    return buildCsv(headers, rows);
};

// ─── User Activity Report ─────────────────────────────────────────────────────

export const generateUserActivityReport = async ({ startDate, endDate, role }) => {
    const { start, end } = parseDateRange(startDate, endDate);

    const where = {
        createdAt: { gte: start, lte: end },
    };
    if (role) where.role = role;

    const users = await prisma.user.findMany({
        where,
        select: {
            id: true,
            email: true,
            role: true,
            isActive: true,
            emailVerified: true,
            createdAt: true,
            customerProfile: { select: { fullName: true } },
            therapistProfile: { select: { fullName: true } },
            subAdminProfile: { select: { fullName: true } },
        },
        orderBy: { createdAt: "desc" },
    });

    const headers = [
        "User ID",
        "Email",
        "Role",
        "Full Name",
        "Active",
        "Email Verified",
        "Created At",
    ];

    const rows = users.map((u) => {
        const fullName =
            u.customerProfile?.fullName ??
            u.therapistProfile?.fullName ??
            u.subAdminProfile?.fullName ??
            "";
        return [
            u.id,
            u.email,
            u.role,
            fullName,
            u.isActive ? "Yes" : "No",
            u.emailVerified ? "Yes" : "No",
            fmtDate(u.createdAt),
        ];
    });

    return buildCsv(headers, rows);
};
