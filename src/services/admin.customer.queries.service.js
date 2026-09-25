import { CUSTOMER_TYPES } from "../utils/constants.js";
import { prisma } from "../config/prisma.js";
import { NotFoundError } from "../utils/errors.js";

const CUSTOMER_LIST_PROFILE_SELECT = {
    id: true,
    fullName: true,
    customerType: true,
    agencyName: true,
    dbaName: true,
    phone: true,
    city: true,
    state: true,
    approvalStatus: true,
    approvedAt: true,
    approvedBy: true,
    rejectionReason: true,
    onboardingStep: true,
    onboardingComplete: true,
    pendingReviewAt: true,
    createdAt: true,
    agencyLicenseDocuments: {
        where: { isDeleted: false },
        select: { id: true },
    },
    customerLicenseDocuments: {
        where: { isDeleted: false },
        select: { id: true },
    },
};

/**
 * Paginated admin list of customers, rooted at CustomerProfile so the
 * (approval_status, created_at) index from CA-1 is used.
 * Defaults to oldest-first (asc) so the review queue is FIFO.
 *
 * @param {object} params
 * @param {string} [params.approvalStatus]
 * @param {string} [params.customerType]
 * @param {string} [params.search]
 * @param {"asc"|"desc"} [params.sortOrder="asc"]
 * @param {number} [params.page=1]
 * @param {number} [params.limit=20]
 * @returns {Promise<{customers: object[], pagination: object}>}
 */
export const listCustomers = async ({
    approvalStatus,
    customerType,
    pendingReview,
    search,
    sortOrder = "asc",
    page = 1,
    limit = 20,
} = {}) => {
    const where = {};
    if (approvalStatus) where.approvalStatus = approvalStatus;
    if (customerType) where.customerType = customerType;
    if (pendingReview === "true") where.pendingReviewAt = { not: null };

    if (search) {
        where.OR = [
            { fullName: { contains: search, mode: "insensitive" } },
            { agencyName: { contains: search, mode: "insensitive" } },
            { dbaName: { contains: search, mode: "insensitive" } },
            { billingEmail: { contains: search, mode: "insensitive" } },
            { user: { email: { contains: search, mode: "insensitive" } } },
        ];
    }

    const [profiles, total] = await Promise.all([
        prisma.customerProfile.findMany({
            where,
            select: {
                ...CUSTOMER_LIST_PROFILE_SELECT,
                user: { select: { id: true, email: true, isActive: true, emailVerified: true, createdAt: true } },
            },
            orderBy: { createdAt: sortOrder },
            skip: (page - 1) * limit,
            take: limit,
        }),
        prisma.customerProfile.count({ where }),
    ]);

    const customers = profiles.map(({ agencyLicenseDocuments, customerLicenseDocuments, ...profile }) => ({
        ...profile,
        documentCount: agencyLicenseDocuments.length + customerLicenseDocuments.length,
    }));

    return {
        customers,
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
};

/**
 * Full customer detail for the admin review screen.
 * Includes both polymorphic document sets, compliance signatures, and
 * consent signatures so one call serves both agency and individual types.
 *
 * @param {string} customerUserId
 * @returns {Promise<object>}
 */
export const getCustomerDetail = async (customerUserId) => {
    const user = await prisma.user.findUnique({
        where: { id: customerUserId },
        select: {
            id: true,
            email: true,
            role: true,
            isActive: true,
            emailVerified: true,
            deactivatedAt: true,
            createdAt: true,
            updatedAt: true,
            customerProfile: {
                include: {
                    agencyLicenseDocuments: {
                        where: { isDeleted: false },
                        orderBy: { uploadedAt: "desc" },
                        select: {
                            id: true,
                            fileName: true,
                            documentType: true,
                            fileSize: true,
                            mimeType: true,
                            uploadedAt: true,
                            status: true,
                            supersedesId: true,
                            verifiedAt: true,
                        },
                    },
                    customerLicenseDocuments: {
                        where: { isDeleted: false },
                        orderBy: { uploadedAt: "desc" },
                        select: {
                            id: true,
                            fileName: true,
                            documentType: true,
                            fileSize: true,
                            mimeType: true,
                            uploadedAt: true,
                            status: true,
                            supersedesId: true,
                            verifiedAt: true,
                        },
                    },
                    agencyComplianceSignatures: {
                        orderBy: { signedAt: "desc" },
                    },
                    customerConsentSignatures: {
                        orderBy: { signedAt: "desc" },
                    },
                    _count: { select: { patients: true, subscriptions: true } },
                },
            },
        },
    });

    if (!user || !user.customerProfile) throw new NotFoundError("Customer not found");

    const isAgency = user.customerProfile.customerType === CUSTOMER_TYPES.AGENCY;

    return {
        ...user,
        customerProfile: {
            ...user.customerProfile,
            documents: isAgency
                ? user.customerProfile.agencyLicenseDocuments
                : user.customerProfile.customerLicenseDocuments,
            signatures: isAgency
                ? user.customerProfile.agencyComplianceSignatures
                : user.customerProfile.customerConsentSignatures,
        },
    };
};
