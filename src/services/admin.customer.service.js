import {
    APPROVAL_STATUS,
    CUSTOMER_TYPES,
    AGENCY_DOCUMENTS_BUCKET,
    INDIVIDUAL_DOCUMENTS_BUCKET,
} from "../utils/constants.js";
import { prisma } from "../config/prisma.js";
import { NotFoundError, ConflictError, BadRequestError } from "../utils/errors.js";
import { logger } from "../config/logger.js";
import { getSignedUrl } from "./storage.service.js";
import { sendCustomerApproved, sendCustomerRejected } from "./email.service.js";

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
 * Resolve the GCS bucket for a customer license document.
 * `bucket` is nullable on rows written before the column existed, and agency
 * and individual documents live in different buckets, so the fallback must
 * branch on which polymorphic FK is populated.
 *
 * @param {{bucket: string|null, agencyId: string|null, customerId: string|null}} document
 * @returns {string}
 */
const resolveDocumentBucket = (document) => {
    if (document.bucket) return document.bucket;
    if (document.agencyId) return AGENCY_DOCUMENTS_BUCKET;
    if (document.customerId) return INDIVIDUAL_DOCUMENTS_BUCKET;
    throw new BadRequestError("Document has no resolvable storage bucket");
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
    search,
    sortOrder = "asc",
    page = 1,
    limit = 20,
} = {}) => {
    const where = {};
    if (approvalStatus) where.approvalStatus = approvalStatus;
    if (customerType) where.customerType = customerType;

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
                    },
                    customerLicenseDocuments: {
                        where: { isDeleted: false },
                        orderBy: { uploadedAt: "desc" },
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

/**
 * Approve a customer. Guards against approving a half-finished application
 * and against double-approval. Sets approvedAt/approvedBy and clears any
 * prior rejection reason.
 *
 * @param {string} customerUserId
 * @param {string} adminId
 * @returns {Promise<object>}
 */
export const approveCustomer = async (customerUserId, adminId) => {
    const user = await prisma.user.findUnique({
        where: { id: customerUserId },
        include: { customerProfile: true },
    });
    if (!user || !user.customerProfile) throw new NotFoundError("Customer not found");
    if (!user.customerProfile.onboardingComplete) {
        throw new BadRequestError("Cannot approve a customer who has not completed onboarding");
    }
    if (user.customerProfile.approvalStatus === APPROVAL_STATUS.APPROVED) {
        throw new ConflictError("Customer is already approved");
    }

    const customer = await prisma.customerProfile.update({
        where: { userId: customerUserId },
        data: {
            approvalStatus: APPROVAL_STATUS.APPROVED,
            approvedAt: new Date(),
            approvedBy: adminId,
            rejectionReason: null,
        },
        select: {
            id: true,
            fullName: true,
            customerType: true,
            agencyName: true,
            approvalStatus: true,
            approvedAt: true,
            approvedBy: true,
            rejectionReason: true,
            user: { select: { id: true, email: true } },
        },
    });

    sendCustomerApproved({ customer }).catch(() => { });

    logger.info("[AdminCustomerService] Customer approved", {
        customerUserId,
        customerType: customer.customerType,
        byAdmin: adminId,
    });

    return customer;
};

/**
 * Reject a customer with a required reason of at least 10 characters.
 * Clears approvedAt/approvedBy so a previously approved customer does not
 * retain a stale approval trail after being rejected.
 *
 * @param {string} customerUserId
 * @param {string} reason
 * @param {string} adminId
 * @returns {Promise<object>}
 */
export const rejectCustomer = async (customerUserId, reason, adminId) => {
    if (!reason || reason.trim().length < 10) {
        throw new BadRequestError("Rejection reason must be at least 10 characters");
    }

    const user = await prisma.user.findUnique({
        where: { id: customerUserId },
        include: { customerProfile: true },
    });
    if (!user || !user.customerProfile) throw new NotFoundError("Customer not found");
    if (user.customerProfile.approvalStatus === APPROVAL_STATUS.REJECTED) {
        throw new ConflictError("Customer is already rejected");
    }

    const trimmedReason = reason.trim();

    const customer = await prisma.customerProfile.update({
        where: { userId: customerUserId },
        data: {
            approvalStatus: APPROVAL_STATUS.REJECTED,
            approvedAt: null,
            approvedBy: null,
            rejectionReason: trimmedReason,
        },
        select: {
            id: true,
            fullName: true,
            customerType: true,
            agencyName: true,
            approvalStatus: true,
            approvedAt: true,
            approvedBy: true,
            rejectionReason: true,
            user: { select: { id: true, email: true } },
        },
    });

    sendCustomerRejected({ customer, reason: trimmedReason }).catch(() => { });

    logger.info("[AdminCustomerService] Customer rejected", {
        customerUserId,
        customerType: customer.customerType,
        byAdmin: adminId,
    });

    return customer;
};

/**
 * Issue a 60-second signed URL for a customer license document.
 *
 * Resolves ownership across both polymorphic FKs on LicenseDocument
 * (agencyId for agency customers, customerId for individual customers).
 * Falls back to the correct bucket per customer type when bucket is null.
 *
 * @param {string} customerUserId
 * @param {string} documentId
 * @returns {Promise<{signedUrl: string, expiresIn: number, fileName: string, fileSize: number, mimeType: string|null, documentType: string}>}
 */
export const getCustomerDocumentSignedUrl = async (customerUserId, documentId) => {
    const document = await prisma.licenseDocument.findUnique({
        where: { id: documentId },
        include: {
            agency: { select: { userId: true } },
            customer: { select: { userId: true } },
        },
    });

    if (!document) throw new NotFoundError("Document not found");
    if (document.isDeleted) throw new NotFoundError("Document has been deleted");

    const ownerUserId = document.agency?.userId ?? document.customer?.userId ?? null;

    if (!ownerUserId) throw new BadRequestError("Document is not owned by a customer");
    if (ownerUserId !== customerUserId) throw new BadRequestError("Document does not belong to this customer");

    const bucket = resolveDocumentBucket(document);
    const { signedUrl } = await getSignedUrl(bucket, document.documentUrl, 60);

    return {
        signedUrl,
        expiresIn: 60,
        fileName: document.fileName,
        fileSize: document.fileSize,
        mimeType: document.mimeType ?? null,
        documentType: document.documentType,
    };
};