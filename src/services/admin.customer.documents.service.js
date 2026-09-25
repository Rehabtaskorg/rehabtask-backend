import { AGENCY_DOCUMENTS_BUCKET, INDIVIDUAL_DOCUMENTS_BUCKET } from "../utils/constants.js";
import { prisma } from "../config/prisma.js";
import { NotFoundError, BadRequestError } from "../utils/errors.js";
import { getSignedUrl } from "./storage.service.js";

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
