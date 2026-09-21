import { prisma } from "../config/prisma.js";
import { NotFoundError, AuthorizationError } from "../utils/errors.js";
import { getSignedUrl } from "./storage.service.js";

const SIGNED_URL_TTL_SECONDS = 60;

/**
 * Issue a short-lived signed URL for a document the caller owns.
 * Ownership is role-agnostic: the document may hang off a therapist profile,
 * an agency customer profile, or an individual customer profile.
 *
 * @param {string} userId - Firebase UID from the authenticated request
 * @param {string} documentId
 * @returns {Promise<{signedUrl: string, expiresIn: number, fileName: string, fileSize: number}>}
 */
export const getDocumentSignedUrl = async (userId, documentId) => {
    const document = await prisma.licenseDocument.findUnique({
        where: { id: documentId },
        include: {
            therapist: { select: { userId: true } },
            agency: { select: { userId: true } },
            customer: { select: { userId: true } },
        },
    });

    if (!document) {
        throw new NotFoundError("Document not found");
    }

    if (document.isDeleted) {
        throw new NotFoundError("Document has been deleted");
    }

    const ownerUserIds = [
        document.userId,
        document.therapist?.userId,
        document.agency?.userId,
        document.customer?.userId,
    ].filter(Boolean);

    if (!ownerUserIds.includes(userId)) {
        throw new AuthorizationError("Not authorized to access this document");
    }

    const { signedUrl } = await getSignedUrl(document.bucket, document.documentUrl, SIGNED_URL_TTL_SECONDS);

    return {
        signedUrl,
        expiresIn: SIGNED_URL_TTL_SECONDS,
        fileName: document.fileName,
        fileSize: document.fileSize,
    };
};
